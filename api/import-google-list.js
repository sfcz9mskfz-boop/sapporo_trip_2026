// Vercel serverless function: /api/import-google-list
// v54: reliable sync import with fallback.
// 1) Try APIFY_ACTOR_ID / maximedupre first for full list.
// 2) If it returns no places or fails, fallback to parseforge so the app gets at least the old 10-place behavior.
// 3) Always return HTTP 200 with safe JSON.
//
// Required:
//   APIFY_TOKEN=<your Apify token>
//
// Recommended:
//   APIFY_ACTOR_ID=maximedupre/google-maps-shared-list-scraper

const FALLBACK_ACTORS = [
  "maximedupre/google-maps-shared-list-scraper",
  "automation-lab/google-maps-shared-list-scraper",
  "getascraper/google-maps-list-scraper",
  "parseforge/google-maps-shared-list-scraper"
];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return safe(res, { importStatus: "saved", message: "Use POST." });

    const body = req.body || {};
    const listUrl = body.listUrl || "";
    if (!isGoogleMapsUrl(listUrl)) {
      return safe(res, { importStatus: "saved", listUrl, message: "Invalid list URL." });
    }

    const token = process.env.APIFY_TOKEN;
    if (!token) {
      return safe(res, { importStatus: "saved", listUrl, message: "APIFY_TOKEN is not configured." });
    }

    const requestedMax = Math.min(Math.max(Number(body.maxPlacesPerList) || 500, 1), 500);
    const preferred = (process.env.APIFY_ACTOR_ID || "").trim();

    // Important: do NOT get stuck at zero. Try preferred actor first, then fall back.
    const actors = unique([
      preferred,
      "maximedupre/google-maps-shared-list-scraper",
      "automation-lab/google-maps-shared-list-scraper",
      "getascraper/google-maps-list-scraper",
      "parseforge/google-maps-shared-list-scraper"
    ].filter(Boolean));

    const attempts = [];
    let best = null;

    for (const actorId of actors) {
      try {
        const result = await runActorSync(actorId, token, listUrl, requestedMax);
        attempts.push({
          actorId,
          pathActorId: toApifyPathActorId(actorId),
          ok: true,
          count: result.places.length,
          listName: result.listName,
          possibleFreeCap: result.possibleFreeCap
        });

        if (!best || result.places.length > best.places.length) best = result;

        // Stop early if full-ish actor worked. If parseforge returns 10, keep only if nothing better worked.
        if (result.places.length > 10 && !result.possibleFreeCap) break;
      } catch (err) {
        attempts.push({
          actorId,
          pathActorId: toApifyPathActorId(actorId),
          ok: false,
          message: err && err.message ? err.message.slice(0, 500) : String(err)
        });
      }
    }

    if (!best || !best.places.length) {
      return safe(res, {
        importStatus: "saved",
        listUrl,
        attempts,
        message: "No places returned."
      });
    }

    return safe(res, {
      ok: true,
      importStatus: "imported",
      source: "apify-google-maps-shared-list-import",
      actorUsed: best.actorUsed,
      pathActorId: toApifyPathActorId(best.actorUsed),
      attempts,
      listUrl,
      listName: best.listName || "Google Maps Shared List",
      count: best.places.length,
      rawItemCount: best.rawItemCount,
      flattenedItemCount: best.flattenedItemCount,
      normalizedCount: best.places.length,
      maxPlacesPerList: requestedMax,
      possibleLimitHit: best.places.length >= requestedMax,
      possibleFreeCap: best.possibleFreeCap,
      places: best.places
    });
  } catch (_err) {
    return safe(res, { importStatus: "saved", places: [], message: "Import did not complete." });
  }
}

function safe(res, data) {
  return res.status(200).json({
    ok: data.importStatus === "imported",
    importStatus: data.importStatus || "saved",
    places: data.places || [],
    ...data
  });
}

function isGoogleMapsUrl(url) {
  return /^https?:\/\/(maps\.app\.goo\.gl|www\.google\.com|google\.com|maps\.google\.com)/i.test(String(url || ""));
}

function toApifyPathActorId(actorId) {
  const raw = String(actorId || "").trim();
  if (!raw) return "";
  if (raw.includes("~")) return raw;
  const parts = raw.split("/");
  if (parts.length >= 2) return `${parts[0]}~${parts.slice(1).join("/")}`;
  return raw;
}

async function runActorSync(actorId, token, listUrl, maxPlacesPerList) {
  const pathActorId = toApifyPathActorId(actorId);
  const input = buildInputForActor(actorId, listUrl, maxPlacesPerList);
  const runUrl =
    `https://api.apify.com/v2/acts/${encodeURIComponent(pathActorId)}` +
    `/run-sync-get-dataset-items?token=${encodeURIComponent(token)}` +
    `&format=json&clean=true&timeout=90&maxItems=1000`;

  const r = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(input)
  });

  const rawText = await r.text();
  let raw;
  try { raw = JSON.parse(rawText); } catch { raw = []; }

  if (!r.ok) {
    throw new Error(`Actor ${actorId} returned ${r.status}: ${rawText.slice(0, 300)}`);
  }

  const flatItems = flattenApifyItems(raw);
  const places = dedupeByStableKey(flatItems.map(normalizePlace).filter(Boolean));
  const listName = extractListName(raw, flatItems, places) || "Google Maps Shared List";

  return {
    actorUsed: actorId,
    rawItemCount: Array.isArray(raw) ? raw.length : 0,
    flattenedItemCount: flatItems.length,
    places,
    listName,
    possibleFreeCap: actorId.includes("parseforge/") && places.length === 10
  };
}

function buildInputForActor(actorId, listUrl, maxPlacesPerList) {
  if (actorId.includes("maximedupre/") || actorId.includes("maximedupre~")) {
    return {
      listUrls: [listUrl],
      maxPlacesPerList,
      maxResults: maxPlacesPerList,
      includeWebsiteEmails: false,
      maxEmailsPerPlace: 3
    };
  }

  if (actorId.includes("parseforge/") || actorId.includes("parseforge~")) {
    return {
      listUrls: [listUrl],
      maxPlacesPerList,
      outputFormat: "json",
      enableAIEnrichment: false,
      maxConcurrency: 5
    };
  }

  if (actorId.includes("getascraper/") || actorId.includes("getascraper~")) {
    return {
      listUrls: [listUrl],
      maxItems: maxPlacesPerList,
      maxResults: maxPlacesPerList,
      maxPlacesPerList,
      minRating: 0,
      minReviewCount: 0,
      filterByCountry: "",
      filterByCategories: [],
      onlyWithWebsite: false,
      onlyWithPhone: false,
      excludePermanentlyClosed: false,
      enrichPlaces: true,
      proxyConfiguration: { useApifyProxy: true }
    };
  }

  if (actorId.includes("automation-lab/") || actorId.includes("automation-lab~")) {
    return {
      listUrls: [listUrl],
      maxPlacesPerList,
      maxResults: maxPlacesPerList,
      includeDetails: false,
      includeWebsiteEmails: false,
      maxEmailsPerPlace: 3,
      language: "en",
      countryCode: "jp"
    };
  }

  return {
    listUrls: [listUrl],
    maxPlacesPerList,
    maxResults: maxPlacesPerList,
    maxItems: maxPlacesPerList,
    includeWebsiteEmails: false,
    maxEmailsPerPlace: 3
  };
}

function flattenApifyItems(raw) {
  const out = [];
  const seen = new Set();

  function visit(value, depth = 0) {
    if (!value || depth > 8) return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (typeof value !== "object") return;

    const arrays = [
      value.places,
      value.items,
      value.results,
      value.data,
      value.businesses,
      value.locations,
      value.records,
      value.rows
    ].filter(Array.isArray);

    const looksLikePlace =
      value.name || value.title || value.placeName || value.placeTitle || value.displayName ||
      value.googleMapsUrl || value.googleMapsUri || value.placeUrl || value.mapsUrl || value.url ||
      value.placeId || value.cid ||
      value.latitude || value.lat || value.location?.lat || value.coordinates?.lat;

    if (looksLikePlace && !isListSummaryOnly(value)) {
      const key = JSON.stringify([
        value.placeId || value.googlePlaceId || value.cid || value.id || "",
        value.googleMapsUrl || value.googleMapsUri || value.url || value.placeUrl || value.mapsUrl || "",
        value.name || value.title || value.placeName || value.placeTitle || "",
        value.latitude || value.lat || value.location?.lat || "",
        value.longitude || value.lng || value.location?.lng || ""
      ]);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
    }

    for (const arr of arrays) visit(arr, depth + 1);
  }

  visit(raw, 0);
  return out;
}

function isListSummaryOnly(item) {
  const hasNested = Array.isArray(item.places) || Array.isArray(item.items) || Array.isArray(item.results);
  const hasPlaceSignal =
    item.placeId || item.googlePlaceId || item.cid || item.googleMapsUrl || item.googleMapsUri || item.placeUrl ||
    item.mapsUrl || item.address || item.formattedAddress || item.latitude || item.lat || item.location?.lat;
  return hasNested && !hasPlaceSignal;
}

function normalizePlace(item) {
  if (!item || typeof item !== "object") return null;

  const displayName =
    typeof item.displayName === "object"
      ? (item.displayName.text || item.displayName.name || "")
      : item.displayName;

  const name =
    item.name ||
    item.title ||
    item.placeName ||
    item.placeTitle ||
    item.locationName ||
    item.businessName ||
    item.poiName ||
    displayName ||
    "";

  const lat =
    item.latitude ??
    item.lat ??
    item.location?.lat ??
    item.coordinates?.lat ??
    item.geometry?.location?.lat ??
    null;

  const lng =
    item.longitude ??
    item.lng ??
    item.lon ??
    item.location?.lng ??
    item.coordinates?.lng ??
    item.geometry?.location?.lng ??
    null;

  const url =
    item.googleMapsUrl ||
    item.googleMapsUri ||
    item.placeUrl ||
    item.mapsUrl ||
    item.shareUrl ||
    item.url ||
    item.link ||
    "";

  if (!name && !url && !(lat != null && lng != null)) return null;

  const sourceListName =
    firstText(item.sourceListNames) ||
    item.sourceListName ||
    firstText(item.sourceListTitles) ||
    item.listName ||
    item.listTitle ||
    item.sharedListName ||
    item.collectionName ||
    "";

  return {
    id: item.placeId || item.googlePlaceId || item.cid || item.id || url || name,
    placeId: item.placeId || item.googlePlaceId || "",
    cid: item.cid || "",
    name,
    address: item.address || item.formattedAddress || item.fullAddress || item.streetAddress || "",
    lat: lat != null ? Number(lat) : null,
    lng: lng != null ? Number(lng) : null,
    url,
    rating: item.rating || item.stars || null,
    reviews: item.reviewsCount || item.reviewCount || item.reviews || item.numberOfReviews || null,
    phone: item.phone || item.phoneNumber || item.telephone || "",
    website: item.website || item.websiteUrl || "",
    category: categorizePlace(item),
    sourceListName,
    sourceListNames: item.sourceListNames || (sourceListName ? [sourceListName] : []),
    raw: item
  };
}

function dedupeByStableKey(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = String(
      item.placeId ||
      item.cid ||
      item.id ||
      item.url ||
      `${item.name}|${item.lat}|${item.lng}`
    ).toLowerCase().replace(/\s+/g, " ");

    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function extractListName(raw, flatItems, places) {
  const candidates = [];

  function add(v) {
    const t = firstText(v);
    if (t) candidates.push(t);
  }

  function visit(v, depth = 0) {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 20)) visit(x, depth + 1);
      return;
    }
    if (typeof v !== "object") return;

    add(v.sourceListNames);
    add(v.sourceListTitles);
    add(v.sourceListName);
    add(v.sourceListTitle);
    add(v.listName);
    add(v.listTitle);
    add(v.sharedListName);
    add(v.collectionName);
    add(v.sourceName);
    if (v.list && typeof v.list === "object") {
      add(v.list.name);
      add(v.list.title);
    }
    visit(v.places, depth + 1);
    visit(v.items, depth + 1);
    visit(v.results, depth + 1);
    visit(v.data, depth + 1);
  }

  visit(raw, 0);
  for (const item of (flatItems || []).slice(0, 50)) visit(item, 0);
  for (const place of (places || []).slice(0, 50)) visit(place, 0);

  return candidates.find((x) =>
    x &&
    !/^google maps shared list$/i.test(x) &&
    !/^google saved list$/i.test(x) &&
    !/^google maps$/i.test(x) &&
    !/^places?$/i.test(x) &&
    !/^https?:\/\//i.test(x)
  ) || "";
}

function firstText(value) {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object") {
        const t = firstText(v.name || v.title || v.value);
        if (t) return t;
      }
    }
    return "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function unique(arr) {
  return [...new Set(arr)];
}

function categorizePlace(item) {
  const text = [
    item.category,
    item.categories,
    item.type,
    item.types,
    item.primaryType,
    item.name,
    item.title,
    item.placeName,
    item.placeTitle
  ]
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/restaurant|food|sushi|ramen|curry|bar|izakaya|seafood|market|식당|맛집|라멘|스시|초밥|해산물|시장/.test(text)) return "food";
  if (/cafe|coffee|dessert|bakery|sweets|카페|커피|디저트|베이커리/.test(text)) return "cafe";
  if (/station|airport|bus|terminal|parking|cruise|pier|transport|교통|역|공항|버스|주차|크루즈/.test(text)) return "transport";
  if (/hotel|inn|ryokan|lodging|onsen|호텔|숙소|료칸|온천/.test(text)) return "lodging";
  if (/shop|shopping|mall|store|outlet|쇼핑|상점|백화점|아울렛/.test(text)) return "shopping";
  if (/museum|park|canal|view|landmark|tourist|attraction|관광|공원|운하|전망|박물관/.test(text)) return "sight";
  return "other";
}
