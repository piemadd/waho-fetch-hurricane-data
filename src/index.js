import { XMLParser } from "fast-xml-parser";
import { kml } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import unzipjs from "./unzipjs.js";

const DEFAULT_RESPONSE = `Use /hurricane.json`.trim();

const kmlToJson = (string) => {
  const parser = new DOMParser();
  const kmlDoc = parser.parseFromString(string, "text/xml");
  const json = kml(kmlDoc);

  return json;
};

const fetchKMZ = async (url) => {
  const arrayBuffer = await fetch(url).then((res) => res.arrayBuffer());

  let finalItems = {};

  let unzip = new unzipjs();
  let unzipped = unzip.parse(arrayBuffer);

  for (let item of unzipped) {
    if (item.name.endsWith("kml")) {
      const res = kmlToJson(item.toString());
      finalItems[item.name] = res;
    } else {
      // return the bytes
      // anything too large we likely don't need
      if (item.buffer.length < 10_000) finalItems[item.name] = item.buffer.toBase64();
      else {
        //console.log(item.name, item.buffer.length);
      }
    }
  }

  return finalItems;
};

const parseRSSFeed = async (feedURL) => {
  const rssFeedData = await fetch(feedURL)
    .then((res) => res.text())
    .then((xmlText) => {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
      const result = parser.parse(xmlText);

      const items = result?.rss?.channel?.item || [];
      const parsedItems = Array.isArray(items) ? items : [items];

      return parsedItems.filter((item) => item.link && (item.link.endsWith("kmz") || item.link.endsWith("kml")));
    });

  let allItems = {};
  for (let i = 0; i < rssFeedData.length; i++) {
    const item = rssFeedData[i];

    if (item.link.endsWith("kml")) {
      const rawKML = await fetch(item.link).then((res) => res.text());
      const json = kmlToJson(rawKML);
      const name = item.link.split("/").at(-1);

      allItems[name] = json;
    } else if (item.link.endsWith("kmz")) {
      const data = await fetchKMZ(item.link);
      Object.keys(data).forEach((fileName) => {
        allItems[fileName] = data[fileName];
      });
    }
  };

  return allItems;
};

const parseMultipleRSSFeeds = async (feedURLs) => {
  let allItems = {};

  const multipleAllItems = await Promise.all(feedURLs.map((url) => parseRSSFeed(url)));

  multipleAllItems.forEach((object) => {
    Object.keys(object).forEach((key) => allItems[key] = object[key]);
  });

  return allItems;
};

export default {
  async fetch(request, env, ctx) {
    const timeGenerated = new Date().toISOString();

    try {
      let returnJSON = false;

      if (request.url.endsWith("hurricane.json")) returnJSON = true;
      else return new Response(DEFAULT_RESPONSE);

      const allItems = await parseMultipleRSSFeeds([
        "https://www.nhc.noaa.gov/gis-at.xml",
        "https://www.nhc.noaa.gov/gis-ep.xml"
      ]);

      if (returnJSON) {
        let finalResponseObj = { timeGenerated, allItems, error: null, errorStack: null };

        return Response.json(finalResponseObj, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
            "cloudflare-cdn-cache-control": "public, max-age=600",
            "cdn-cache-control": "public, max-age=600",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Last-Modified",
            "Last-Modified": timeGenerated
          }
        });
      } else {
        // we shouldnt be here
        return new Response(DEFAULT_RESPONSE);
      }
    } catch (e) {
      console.log(e);
      return Response.json(
        { timeGenerated, allItems: {}, error: e.toString(), errorStack: e.stack },
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Last-Modified",
            "Last-Modified": timeGenerated
          }
        }
      );
    }
  }
};
