import { XMLParser } from "fast-xml-parser";
import { kml } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import unzipjs from "./unzipjs.js";

const DEFAULT_RESPONSE = `
WIP...`.trim();

// https://microlink.io/user-agents
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
];

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

export default {
  async fetch(request, env, ctx) {
    const timeGenerated = new Date().toISOString();

    try {
      let returnJSON = false;

      if (request.url.endsWith("hurricane.json")) returnJSON = true;
      else return new Response(DEFAULT_RESPONSE);

      const rssFeedData = await fetch("https://www.nhc.noaa.gov/gis-at.xml")
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
      }
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
        { locations: [], specialHoursLocations: [], notOpenLocations: [], error: e.toString(), errorStack: e.stack },
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
