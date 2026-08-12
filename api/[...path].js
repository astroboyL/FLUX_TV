import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ATTRIBUTE_REGEX = /([\w-]+)="([^"]*)"/g;
const CATALOG_TTL_MS = 1000 * 60 * 15;
const EPG_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_STORED_ITEMS = 90000;
const MAX_RAILS_PER_SECTION = 24;
const MAX_ITEMS_PER_RAIL = 36;
const PLAYLIST_FETCH_TIMEOUT_MS = 18000;

let catalogCache;
let catalogLoadingPromise;
let epgCache;
let epgLoadingPromise;

function normalizeText(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeSearchText(value = "") {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCategoryForCopy(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^CANAIS\s*\|\s*/i, "")
    .replace(/^FILMES\s*\|\s*/i, "")
    .replace(/^SERIES\s*\|\s*/i, "")
    .replace(/^S(?:E|Ã‰)RIES\s*\|\s*/i, "")
    .trim();
}

function getSearchTokens(value) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function getLevenshteinDistance(a, b, maxDistance) {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      rowMin = Math.min(rowMin, current[j]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function isCloseSearchToken(queryToken, candidateToken) {
  if (queryToken.length < 3 || candidateToken.length < 3) {
    return false;
  }

  if (queryToken[0] !== candidateToken[0]) {
    return false;
  }

  const maxDistance =
    queryToken.length <= 4 ? 1 : queryToken.length <= 8 ? 2 : 3;

  return getLevenshteinDistance(queryToken, candidateToken, maxDistance) <= maxDistance;
}

function getFuzzySearchScore(item, query) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return 1;
  }

  const searchText =
    item.searchText ||
    normalizeSearchText(`${item.name} ${item.group || ""} ${item.tvgName || ""}`);

  if (searchText.includes(normalizedQuery)) {
    return 1000 - Math.min(searchText.indexOf(normalizedQuery), 300);
  }

  const queryTokens = getSearchTokens(normalizedQuery);
  const candidateTokens = searchText.split(" ").filter(Boolean);
  const nameTokens = getSearchTokens(item.name || "");

  if (!queryTokens.length || !candidateTokens.length) {
    return 0;
  }

  let matchedTokens = 0;
  let score = 0;

  for (const queryToken of queryTokens) {
    if (candidateTokens.includes(queryToken)) {
      matchedTokens += 1;
      score += nameTokens.includes(queryToken) ? 170 : 120;
      continue;
    }

    if (candidateTokens.some((token) => token.startsWith(queryToken))) {
      matchedTokens += 1;
      score += nameTokens.some((token) => token.startsWith(queryToken)) ? 145 : 95;
      continue;
    }

    if (
      queryToken.length > 3 &&
      candidateTokens.some((token) => token.includes(queryToken))
    ) {
      matchedTokens += 1;
      score += 75;
      continue;
    }

    if (candidateTokens.some((token) => isCloseSearchToken(queryToken, token))) {
      matchedTokens += 1;
      score += nameTokens.some((token) => isCloseSearchToken(queryToken, token))
        ? 110
        : 58;
    }
  }

  const requiredMatches =
    queryTokens.length === 1 ? 1 : Math.ceil(queryTokens.length * 0.62);

  if (matchedTokens < requiredMatches) {
    return 0;
  }

  const bestNameDistance = queryTokens.reduce((total, queryToken) => {
    const distances = nameTokens
      .filter((token) => token[0] === queryToken[0])
      .map((token) => getLevenshteinDistance(queryToken, token, 4));

    return total + Math.min(...distances, 5);
  }, 0);

  return score + matchedTokens * 12 - bestNameDistance * 12;
}

function parseAttributes(line) {
  const attributes = {};
  let match;

  while ((match = ATTRIBUTE_REGEX.exec(line)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function getName(line, attributes) {
  const commaIndex = line.lastIndexOf(",");
  const fallbackName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
  return attributes["tvg-name"] || fallbackName || "Sem titulo";
}

function getContentType(name, group, url) {
  const normalizedUrl = url.toLowerCase();
  const normalizedText = normalizeText(`${group || ""} ${name}`);

  if (
    normalizedUrl.includes("/series/") ||
    normalizedText.includes("series") ||
    normalizedText.includes("serie") ||
    normalizedText.includes("temporada") ||
    /\bs\d{1,2}\s*e\d{1,3}\b/i.test(name)
  ) {
    return "series";
  }

  if (
    normalizedUrl.includes("/movie/") ||
    normalizedText.includes("filmes") ||
    normalizedText.includes("filme") ||
    normalizedText.includes("movies") ||
    normalizedText.includes("cinema") ||
    normalizedText.includes("vod") ||
    normalizedText.includes("lancamento")
  ) {
    return "movie";
  }

  return "live";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PLAYLIST_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function parsePlaylistResponse(response) {
  if (!response.body) {
    throw new Error("Lista IPTV sem corpo de resposta.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const items = [];
  const counts = { live: 0, movie: 0, series: 0 };
  let pending;
  let buffer = "";
  let firstLineChecked = false;

  const processLine = (rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      return;
    }

    if (!firstLineChecked) {
      firstLineChecked = true;

      if (!line.startsWith("#EXTM3U")) {
        throw new Error("Resposta IPTV nao parece M3U.");
      }
    }

    if (line.startsWith("#EXTINF")) {
      const attributes = parseAttributes(line);
      pending = {
        name: getName(line, attributes),
        logo: attributes["tvg-logo"],
        group: attributes["group-title"] || "Sem categoria",
        tvgId: attributes["tvg-id"],
        tvgName: attributes["tvg-name"],
      };
      return;
    }

    if (line.startsWith("#EXTGRP") && pending) {
      pending.group = line.replace("#EXTGRP:", "").trim() || pending.group;
      return;
    }

    if (line.startsWith("#") || !pending) {
      return;
    }

    const contentType = getContentType(pending.name, pending.group, line);
    counts[contentType] += 1;
    items.push({
      id: `${items.length}-${contentType}-${pending.name}`,
      ...pending,
      url: line,
      contentType,
    });
    pending = undefined;
  };

  while (items.length < MAX_STORED_ITEMS) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      processLine(line);

      if (items.length >= MAX_STORED_ITEMS) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }

  if (buffer && items.length < MAX_STORED_ITEMS) {
    processLine(buffer);
  }

  return { items, counts };
}

function getXtreamConfig() {
  const baseUrl = process.env.VITE_APP_XTREAM_BASE_URL;
  const username = process.env.VITE_APP_XTREAM_USERNAME;
  const password = process.env.VITE_APP_XTREAM_PASSWORD;

  if (!baseUrl || !username || !password) {
    return undefined;
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    username,
    password,
  };
}

function getXtreamApiUrl(config, action) {
  return `${config.baseUrl}/player_api.php?username=${encodeURIComponent(
    config.username
  )}&password=${encodeURIComponent(config.password)}&action=${action}`;
}

async function fetchXtreamJson(config, action) {
  const response = await fetchWithTimeout(getXtreamApiUrl(config, action), {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      Referer: `${config.baseUrl}/`,
    },
  });

  if (!response.ok) {
    throw new Error(`Xtream ${action}: HTTP ${response.status}`);
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Xtream ${action}: resposta nao veio em JSON valido`);
  }
}

function buildXtreamCategoryMap(categories) {
  const map = new Map();

  if (!Array.isArray(categories)) {
    return map;
  }

  for (const category of categories) {
    if (category?.category_id && category?.category_name) {
      map.set(String(category.category_id), String(category.category_name));
    }
  }

  return map;
}

function getXtreamGroup(categoryMap, categoryId, fallback, prefix) {
  const category = categoryMap.get(String(categoryId || "")) || fallback;
  return `${prefix} | ${category}`;
}

function normalizeXtreamItems({ config, liveStreams, vodStreams, seriesList, categories }) {
  const liveCategories = buildXtreamCategoryMap(categories.live);
  const movieCategories = buildXtreamCategoryMap(categories.movie);
  const seriesCategories = buildXtreamCategoryMap(categories.series);
  const encodedUsername = encodeURIComponent(config.username);
  const encodedPassword = encodeURIComponent(config.password);
  const items = [];
  const counts = { live: 0, movie: 0, series: 0 };

  if (Array.isArray(liveStreams)) {
    for (const stream of liveStreams) {
      if (!stream?.stream_id || !stream?.name) {
        continue;
      }

      counts.live += 1;
      items.push({
        id: `xtream-live-${stream.stream_id}`,
        name: String(stream.name),
        url: `${config.baseUrl}/live/${encodedUsername}/${encodedPassword}/${stream.stream_id}.m3u8`,
        logo: stream.stream_icon,
        group: getXtreamGroup(
          liveCategories,
          stream.category_id,
          "Canais",
          "CANAIS"
        ),
        tvgId: stream.epg_channel_id,
        tvgName: stream.name,
        contentType: "live",
      });
    }
  }

  if (Array.isArray(vodStreams)) {
    for (const stream of vodStreams) {
      if (!stream?.stream_id || !stream?.name) {
        continue;
      }

      const extension = String(stream.container_extension || "mp4").replace(/^\./, "");
      counts.movie += 1;
      items.push({
        id: `xtream-movie-${stream.stream_id}`,
        name: String(stream.name),
        url: `${config.baseUrl}/movie/${encodedUsername}/${encodedPassword}/${stream.stream_id}.${extension}`,
        logo: stream.stream_icon,
        group: getXtreamGroup(
          movieCategories,
          stream.category_id,
          "Filmes",
          "FILMES"
        ),
        tvgId: String(stream.stream_id),
        tvgName: stream.name,
        contentType: "movie",
      });
    }
  }

  if (Array.isArray(seriesList)) {
    for (const series of seriesList) {
      if (!series?.series_id || !series?.name) {
        continue;
      }

      counts.series += 1;
      items.push({
        id: `xtream-series-${series.series_id}`,
        name: String(series.name),
        url: `${config.baseUrl}/player_api.php?username=${encodedUsername}&password=${encodedPassword}&action=get_series_info&series_id=${series.series_id}`,
        logo: series.cover,
        group: getXtreamGroup(
          seriesCategories,
          series.category_id,
          "Series",
          "SERIES"
        ),
        tvgId: String(series.series_id),
        tvgName: series.name,
        contentType: "series",
      });
    }
  }

  return { items, counts };
}

async function loadXtreamCatalog() {
  const config = getXtreamConfig();

  if (!config) {
    throw new Error("Configure VITE_APP_XTREAM_BASE_URL, USERNAME e PASSWORD na Vercel.");
  }

  const results = await Promise.allSettled([
    fetchXtreamJson(config, "get_live_categories"),
    fetchXtreamJson(config, "get_vod_categories"),
    fetchXtreamJson(config, "get_series_categories"),
    fetchXtreamJson(config, "get_live_streams"),
    fetchXtreamJson(config, "get_vod_streams"),
    fetchXtreamJson(config, "get_series"),
  ]);

  const [liveCategories, movieCategories, seriesCategories] = results
    .slice(0, 3)
    .map((result) => (result.status === "fulfilled" ? result.value : []));
  const [liveStreams, vodStreams, seriesList] = results
    .slice(3)
    .map((result) => (result.status === "fulfilled" ? result.value : []));

  const parsed = normalizeXtreamItems({
    config,
    liveStreams,
    vodStreams,
    seriesList,
    categories: {
      live: liveCategories,
      movie: movieCategories,
      series: seriesCategories,
    },
  });

  const parsedTotal = parsed.counts.live + parsed.counts.movie + parsed.counts.series;

  if (parsedTotal < 10) {
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(failures || "Xtream JSON sem conteudo suficiente.");
  }

  return parsed;
}

function hasBrowserRiskyCodec(item) {
  const text = item.searchText || normalizeSearchText(`${item.name} ${item.group || ""}`);
  return text.includes("h265") || text.includes("h 265") || text.includes("hevc");
}

function isQualityCategory(group = "") {
  const category = normalizeSearchText(group)
    .replace(/^filmes\s*/, "")
    .replace(/^series\s*/, "")
    .replace(/^serie\s*/, "")
    .trim();

  return ["4k", "uhd 4k", "uhd", "fhd", "full hd", "hd", "h265", "hevc"].includes(
    category
  );
}

function prepareCatalogItem(item) {
  const searchText = normalizeSearchText(
    `${item.name} ${item.group || ""} ${item.tvgName || ""} ${item.tvgId || ""}`
  );

  return {
    ...item,
    searchText,
    normalizedGroup: normalizeSearchText(item.group || ""),
    normalizedUrl: item.url.toLowerCase(),
    riskyCodec: hasBrowserRiskyCodec({ ...item, searchText }),
    anime: isAnimeCatalogItem({ ...item, searchText }),
  };
}

function belongsToSection(item, contentType) {
  if (contentType === "live") {
    return item.contentType === "live";
  }

  const group = item.normalizedGroup || normalizeSearchText(item.group || "");
  const url = item.normalizedUrl || item.url.toLowerCase();

  if (contentType === "movie") {
    return (
      item.contentType === "movie" &&
      !group.startsWith("canais") &&
      !group.startsWith("series") &&
      !group.startsWith("serie") &&
      !group.includes("anime") &&
      (group.startsWith("filmes") ||
        group.startsWith("movies") ||
        group === "outros" ||
        (group === "sem categoria" && url.includes("/movie/")))
    );
  }

  return (
    item.contentType === "series" &&
    !group.startsWith("canais") &&
    !group.startsWith("filmes") &&
    (group.startsWith("series") ||
      group.startsWith("serie") ||
      group.includes("crunchyroll") ||
      group.includes("anime") ||
      (group === "sem categoria" && url.includes("/series/")))
  );
}

function isAnimeCatalogItem(item) {
  if (typeof item.anime === "boolean") {
    return item.anime;
  }

  const text = item.searchText || normalizeSearchText(`${item.name} ${item.group || ""}`);
  return [
    "anime",
    "animes",
    "animacao",
    "animation",
    "crunchyroll",
    "manga",
    "desenho",
    "demon slayer",
    "kimetsu",
    "jujutsu",
    "naruto",
    "boruto",
    "one piece",
    "dragon ball",
    "bleach",
    "shingeki",
    "attack on titan",
    "hunter x hunter",
    "one punch",
  ].some((token) => text.includes(token));
}

function buildSectionItems(items) {
  return {
    live: items.filter((item) => belongsToSection(item, "live")),
    movie: items.filter((item) => belongsToSection(item, "movie")),
    series: items.filter((item) => belongsToSection(item, "series")),
  };
}

function buildCategories(items, contentType) {
  const counts = new Map();

  for (const item of items) {
    if (
      item.contentType !== contentType ||
      !belongsToSection(item, contentType) ||
      isQualityCategory(item.group || "")
    ) {
      continue;
    }

    const group = item.group || "Sem categoria";
    counts.set(group, (counts.get(group) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }));
}

function buildRails(items, contentType) {
  const groups = new Map();

  for (const item of items) {
    if (item.contentType !== contentType || !belongsToSection(item, contentType)) {
      continue;
    }

    const group = item.group || "Sem categoria";
    const groupItems = groups.get(group) || [];

    if (groupItems.length < MAX_ITEMS_PER_RAIL) {
      groupItems.push(item);
      groups.set(group, groupItems);
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_RAILS_PER_SECTION)
    .map(([title, items]) => ({ title, items }));
}

function getFilteredItems({
  items,
  type,
  category,
  query,
  includeRiskyCodecs,
  animeOnly,
  excludeAnime,
}) {
  const normalizedQuery = normalizeSearchText(query);

  return items
    .map((item) => ({
      item,
      searchScore: normalizedQuery ? getFuzzySearchScore(item, normalizedQuery) : 1,
    }))
    .filter(({ item, searchScore }) => {
      const matchesType = type === "all" || item.contentType === type;
      const matchesSection = type === "all" || belongsToSection(item, type);
      const matchesCategory =
        !category || category === "Todos" || (item.group || "Sem categoria") === category;
      const matchesQuery = !normalizedQuery || searchScore > 0;
      const matchesCodec = includeRiskyCodecs || !hasBrowserRiskyCodec(item);
      const matchesAnime = !animeOnly || isAnimeCatalogItem(item);
      const matchesAnimeExclusion = !excludeAnime || !isAnimeCatalogItem(item);

      return (
        matchesType &&
        matchesSection &&
        matchesCategory &&
        matchesQuery &&
        matchesCodec &&
        matchesAnime &&
        matchesAnimeExclusion
      );
    })
    .sort((a, b) => b.searchScore - a.searchScore)
    .map(({ item }) => item);
}

function getPlaylistUrls() {
  const xtreamBaseUrl = process.env.VITE_APP_XTREAM_BASE_URL;
  const xtreamUsername = process.env.VITE_APP_XTREAM_USERNAME;
  const xtreamPassword = process.env.VITE_APP_XTREAM_PASSWORD;
  const xtreamUrls =
    xtreamBaseUrl && xtreamUsername && xtreamPassword
      ? [
          `${xtreamBaseUrl.replace(/\/$/, "")}/get.php?username=${encodeURIComponent(
            xtreamUsername
          )}&password=${encodeURIComponent(
            xtreamPassword
          )}&type=m3u_plus&output=m3u8`,
          `${xtreamBaseUrl.replace(/\/$/, "")}/get.php?username=${encodeURIComponent(
            xtreamUsername
          )}&password=${encodeURIComponent(
            xtreamPassword
          )}&type=m3u_plus&output=ts`,
        ]
      : [];

  return [
    ...xtreamUrls,
    process.env.VITE_APP_IPTV_PLAYLIST_URL,
    process.env.VITE_APP_IPTV_M3U_URL,
    process.env.VITE_APP_IPTV_SSIPTV_URL,
  ].filter(Boolean);
}

function describePlaylistUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const output = parsedUrl.searchParams.get("output");
    const type = parsedUrl.searchParams.get("type");
    const detail = [type, output].filter(Boolean).join("/");
    return `${parsedUrl.hostname}${detail ? ` (${detail})` : ""}`;
  } catch {
    return "lista configurada";
  }
}

function buildCatalog(preparedItems) {
  const sectionItems = buildSectionItems(preparedItems);

  return {
    createdAt: Date.now(),
    items: preparedItems,
    sectionItems,
    counts: {
      live: sectionItems.live.length,
      movie: sectionItems.movie.length,
      series: sectionItems.series.length,
    },
    categories: {
      live: buildCategories(sectionItems.live, "live"),
      movie: buildCategories(sectionItems.movie, "movie"),
      series: buildCategories(sectionItems.series, "series"),
    },
    rails: {
      live: buildRails(sectionItems.live, "live"),
      movie: buildRails(sectionItems.movie, "movie"),
      series: buildRails(sectionItems.series, "series"),
    },
  };
}

async function loadCatalog() {
  if (catalogCache && Date.now() - catalogCache.createdAt < CATALOG_TTL_MS) {
    return catalogCache;
  }

  if (catalogLoadingPromise) {
    return catalogLoadingPromise;
  }

  catalogLoadingPromise = (async () => {
    const playlistUrls = getPlaylistUrls();
    const errors = [];

    if (!playlistUrls.length) {
      errors.push("Nenhuma URL M3U/HLS configurada.");
    }

    for (const playlistUrl of playlistUrls) {
      try {
        const response = await fetchWithTimeout(playlistUrl, {
          headers: {
            Accept:
              "application/x-mpegURL, application/vnd.apple.mpegurl, text/plain, */*",
            "User-Agent": "Mozilla/5.0 IPTV Player",
          },
        });

        if (!response.ok) {
          errors.push(`${describePlaylistUrl(playlistUrl)}: HTTP ${response.status}`);
          continue;
        }

        const parsed = await parsePlaylistResponse(response);
        const preparedItems = parsed.items.map(prepareCatalogItem);
        const parsedTotal =
          parsed.counts.live + parsed.counts.movie + parsed.counts.series;

        if (parsedTotal < 10) {
          errors.push(
            `${describePlaylistUrl(playlistUrl)}: lista sem conteudo reproduzivel`
          );
          continue;
        }

        catalogCache = buildCatalog(preparedItems);

        return catalogCache;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "falha ao carregar lista");
      }
    }

    try {
      const parsed = await loadXtreamCatalog();
      catalogCache = buildCatalog(parsed.items.map(prepareCatalogItem));
      return catalogCache;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "falha ao carregar Xtream JSON");
    }

    throw new Error(errors.filter(Boolean).join("; ") || "Nenhuma lista IPTV respondeu.");
  })().finally(() => {
    catalogLoadingPromise = undefined;
  });

  return catalogLoadingPromise;
}

function decodeXmlValue(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getXmlTagValue(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlValue(match[1]) : "";
}

function cleanLookupName(value = "") {
  return normalizeSearchText(value)
    .replace(/\b(?:fhd|full hd|uhd|4k|hd|sd|h265|h\.265|hevc|dual|dub|dublado|legendado|leg)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseXmltvDate(value = "") {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/
  );

  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second, offset = "+0000"] = match;
  const offsetSign = offset.startsWith("-") ? -1 : 1;
  const offsetHours = Number(offset.slice(1, 3));
  const offsetMinutes = Number(offset.slice(3, 5));
  const utcTime = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  return utcTime - offsetSign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;
}

function parseEpgXml(content) {
  const now = Date.now();
  const channelNames = new Map();
  const channelPrograms = new Map();
  const titleDescriptions = new Map();
  const channelRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
  const programmeRegex = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/gi;
  let channelMatch;
  let programmeMatch;
  let totalPrograms = 0;

  while ((channelMatch = channelRegex.exec(content)) !== null) {
    const [, channelId, block] = channelMatch;
    const displayNames = [...block.matchAll(/<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/gi)]
      .map((match) => decodeXmlValue(match[1]))
      .filter(Boolean);

    channelNames.set(channelId, displayNames);
  }

  while ((programmeMatch = programmeRegex.exec(content)) !== null) {
    const [, attrs, block] = programmeMatch;
    const channel = attrs.match(/\bchannel="([^"]+)"/i)?.[1] || "";
    const start = parseXmltvDate(attrs.match(/\bstart="([^"]+)"/i)?.[1] || "");
    const stop = parseXmltvDate(attrs.match(/\bstop="([^"]+)"/i)?.[1] || "");
    const title = getXmlTagValue(block, "title");
    const desc = getXmlTagValue(block, "desc");

    if (!title) {
      continue;
    }

    totalPrograms += 1;
    const program = { title, desc, start, stop };
    const titleKey = cleanLookupName(title);

    if (titleKey && (desc || !titleDescriptions.has(titleKey))) {
      titleDescriptions.set(titleKey, program);
    }

    if (channel && start && stop && start <= now && stop >= now) {
      channelPrograms.set(cleanLookupName(channel), program);

      for (const displayName of channelNames.get(channel) || []) {
        channelPrograms.set(cleanLookupName(displayName), program);
      }
    }
  }

  return { createdAt: now, channelPrograms, titleDescriptions, totalPrograms };
}

function buildLocalSynopsis(item) {
  const title = item.name || "Este titulo";
  const category = formatCategoryForCopy(item.group || "catalogo");

  if (item.contentType === "live") {
    return `${title} e um canal ao vivo da categoria ${category}, pronto para assistir.`;
  }

  return `${title} esta disponivel na categoria ${category}. Abra para assistir, salvar ou encontrar titulos semelhantes.`;
}

function buildEpgSynopsis(item, epg) {
  const fallback = buildLocalSynopsis(item);

  if (!epg) {
    return { synopsis: fallback, provider: "local" };
  }

  const lookupNames = [item.tvgId, item.tvgName, item.name]
    .filter(Boolean)
    .map((value) => cleanLookupName(String(value)));

  if (item.contentType === "live") {
    const program = lookupNames
      .map((name) => epg.channelPrograms.get(name))
      .find(Boolean);

    if (program) {
      return {
        synopsis: program.desc
          ? `Agora: ${program.title}. ${program.desc}`
          : `Agora no ar: ${program.title}.`,
        provider: "epg",
        programme: program.title,
      };
    }
  }

  const program = lookupNames
    .map((name) => epg.titleDescriptions.get(name))
    .find((match) => match?.desc);

  if (program?.desc) {
    return { synopsis: program.desc, provider: "epg", programme: program.title };
  }

  return { synopsis: fallback, provider: "local-fallback" };
}

async function loadEpg() {
  if (epgCache && Date.now() - epgCache.createdAt < EPG_TTL_MS) {
    return epgCache;
  }

  if (epgLoadingPromise) {
    return epgLoadingPromise;
  }

  epgLoadingPromise = (async () => {
    try {
      const localContent = await readFile(join(process.cwd(), "public", "epg", "epg.xml"), "utf-8");
      epgCache = parseEpgXml(localContent);
      return epgCache;
    } catch {
      // Vercel normally uses VITE_APP_IPTV_EPG_URL instead of the ignored local XML.
    }

    if (!process.env.VITE_APP_IPTV_EPG_URL) {
      return undefined;
    }

    try {
      const response = await fetchWithTimeout(process.env.VITE_APP_IPTV_EPG_URL, {
        headers: {
          Accept: "application/xml, text/xml, */*",
          "User-Agent": "Mozilla/5.0 IPTV Player",
        },
      });

      if (!response.ok) {
        return undefined;
      }

      epgCache = parseEpgXml(await response.text());
      return epgCache;
    } catch {
      return undefined;
    }
  })().finally(() => {
    epgLoadingPromise = undefined;
  });

  return epgLoadingPromise;
}

function sendJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Cache-Control", "no-store");
  response.json(payload);
}

function rewriteHlsManifest(content, baseUrl) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        return line;
      }

      return `/api/iptv/proxy?url=${encodeURIComponent(
        new URL(trimmedLine, baseUrl).toString()
      )}`;
    })
    .join("\n");
}

function getStreamHeaders(range) {
  const headers = {
    "User-Agent": "Mozilla/5.0 IPTV Player",
  };

  if (typeof range === "string" && range) {
    headers.Range = range;
  }

  return headers;
}

async function pipeResponse(upstream, response) {
  response.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (
      [
        "content-type",
        "content-length",
        "accept-ranges",
        "content-range",
        "cache-control",
      ].includes(key.toLowerCase())
    ) {
      response.setHeader(key, value);
    }
  });
  response.setHeader("Access-Control-Allow-Origin", "*");

  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    response.write(value);
  }

  response.end();
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf-8");
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

export default async function handler(request, response) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname === "/api/epg/synopsis") {
      const body = await readJsonBody(request);
      const epg = await loadEpg();
      sendJson(response, 200, buildEpgSynopsis(body?.item || body || {}, epg));
      return;
    }

    const catalog = await loadCatalog();

    if (pathname === "/api/iptv/catalog") {
      sendJson(response, 200, {
        counts: catalog.counts,
        categories: catalog.categories,
        rails: catalog.rails,
        featured:
          catalog.items.find(
            (item) => item.contentType === "live" && !hasBrowserRiskyCodec(item)
          ) ||
          catalog.items.find((item) => item.contentType === "live") ||
          catalog.items[0] ||
          null,
        cachedAt: catalog.createdAt,
      });
      return;
    }

    if (pathname === "/api/iptv/items") {
      const type = url.searchParams.get("type") || "live";
      const category = url.searchParams.get("category") || "Todos";
      const query = url.searchParams.get("q") || "";
      const includeRiskyCodecs = url.searchParams.get("includeRiskyCodecs") === "1";
      const animeOnly = url.searchParams.get("animeOnly") === "1";
      const excludeAnime = url.searchParams.get("excludeAnime") === "1";
      const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
      const pageSize = Math.min(
        Math.max(Number(url.searchParams.get("pageSize") || 72), 24),
        120
      );
      const sourceItems = type === "all" ? catalog.items : catalog.sectionItems[type] || [];
      const filteredItems = getFilteredItems({
        items: sourceItems,
        type,
        category,
        query,
        includeRiskyCodecs,
        animeOnly,
        excludeAnime,
      });
      const start = (page - 1) * pageSize;

      sendJson(response, 200, {
        items: filteredItems.slice(start, start + pageSize),
        total: filteredItems.length,
        page,
        pageSize,
        hasMore: start + pageSize < filteredItems.length,
      });
      return;
    }

    if (pathname === "/api/iptv/search") {
      const query = normalizeSearchText(url.searchParams.get("q") || "");
      const type = url.searchParams.get("type");
      const results = catalog.items
        .map((item) => ({
          item,
          searchScore: query ? getFuzzySearchScore(item, query) : 1,
        }))
        .filter(({ item, searchScore }) => {
          const matchesType = !type || type === "all" || item.contentType === type;
          const matchesQuery = !query || searchScore > 0;
          return matchesType && matchesQuery;
        })
        .sort((a, b) => b.searchScore - a.searchScore)
        .map(({ item }) => item)
        .slice(0, 120);

      sendJson(response, 200, { results });
      return;
    }

    if (pathname === "/api/iptv/stream") {
      const id = url.searchParams.get("id");
      const item = catalog.items.find((catalogItem) => catalogItem.id === id);

      if (!item) {
        sendJson(response, 404, { error: "Item nao encontrado." });
        return;
      }

      const upstream = await fetch(item.url, {
        headers: getStreamHeaders(request.headers.range),
      });
      const contentType = upstream.headers.get("content-type") || "";

      if (item.url.toLowerCase().includes(".m3u8") || contentType.includes("mpegurl")) {
        const manifest = await upstream.text();
        response.statusCode = upstream.status;
        response.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.end(rewriteHlsManifest(manifest, item.url));
        return;
      }

      await pipeResponse(upstream, response);
      return;
    }

    if (pathname === "/api/iptv/proxy") {
      const targetUrl = url.searchParams.get("url");

      if (!targetUrl) {
        sendJson(response, 400, { error: "URL ausente." });
        return;
      }

      const upstream = await fetch(targetUrl, {
        headers: getStreamHeaders(request.headers.range),
      });
      const contentType = upstream.headers.get("content-type") || "";

      if (targetUrl.toLowerCase().includes(".m3u8") || contentType.includes("mpegurl")) {
        const manifest = await upstream.text();
        response.statusCode = upstream.status;
        response.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.end(rewriteHlsManifest(manifest, targetUrl));
        return;
      }

      await pipeResponse(upstream, response);
      return;
    }

    sendJson(response, 404, { error: "Rota API nao encontrada." });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Erro interno da API.",
    });
  }
}
