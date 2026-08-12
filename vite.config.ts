import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import tsconfigPaths from "vite-tsconfig-paths";

type IptvContentType = "live" | "movie" | "series";

type IptvItem = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  contentType: IptvContentType;
  searchText?: string;
  normalizedGroup?: string;
  normalizedUrl?: string;
  riskyCodec?: boolean;
  anime?: boolean;
};

type IptvRail = {
  title: string;
  items: IptvItem[];
};

type IptvCategory = {
  name: string;
  count: number;
};

type IptvSectionItems = Record<IptvContentType, IptvItem[]>;

type EpgProgram = {
  title: string;
  desc: string;
  start?: number;
  stop?: number;
};

type EpgCatalog = {
  createdAt: number;
  channelPrograms: Map<string, EpgProgram>;
  titleDescriptions: Map<string, EpgProgram>;
  totalPrograms: number;
};

const ATTRIBUTE_REGEX = /([\w-]+)="([^"]*)"/g;
const CATALOG_TTL_MS = 1000 * 60 * 15;
const MAX_STORED_ITEMS = 90000;
const MAX_RAILS_PER_SECTION = 24;
const MAX_ITEMS_PER_RAIL = 36;
const PLAYLIST_FETCH_TIMEOUT_MS = 18000;
const EPG_TTL_MS = 1000 * 60 * 60 * 6;

function parseAttributes(line: string) {
  const attributes: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = ATTRIBUTE_REGEX.exec(line)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeSearchText(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchTokens(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function getLevenshteinDistance(a: string, b: string, maxDistance: number) {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

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

function isCloseSearchToken(queryToken: string, candidateToken: string) {
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

function getFuzzySearchScore(item: IptvItem, query: string) {
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

  return (
    score +
    matchedTokens * 12 -
    bestNameDistance * 12 -
    Math.max(0, candidateTokens.length - 5)
  );
}

function formatCategoryForCopy(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^CANAIS\s*\|\s*/i, "")
    .replace(/^FILMES\s*\|\s*/i, "")
    .replace(/^SERIES\s*\|\s*/i, "")
    .replace(/^S(?:E|É)RIES\s*\|\s*/i, "")
    .trim();
}

function getName(line: string, attributes: Record<string, string>) {
  const commaIndex = line.lastIndexOf(",");
  const fallbackName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
  return attributes["tvg-name"] || fallbackName || "Sem titulo";
}

function getContentType(name: string, group: string | undefined, url: string) {
  const normalizedUrl = url.toLowerCase();
  const normalizedText = normalizeText(`${group || ""} ${name}`);

  if (
    normalizedUrl.includes("/series/") ||
    normalizedText.includes("series") ||
    normalizedText.includes("serie") ||
    normalizedText.includes("temporada") ||
    /\bs\d{1,2}\s*e\d{1,3}\b/i.test(name)
  ) {
    return "series" as const;
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
    return "movie" as const;
  }

  return "live" as const;
}

function parsePlaylist(content: string) {
  const items: IptvItem[] = [];
  const counts: Record<IptvContentType, number> = {
    live: 0,
    movie: 0,
    series: 0,
  };
  let pending:
    | {
        name: string;
        logo?: string;
        group?: string;
        tvgId?: string;
        tvgName?: string;
      }
    | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
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
      continue;
    }

    if (line.startsWith("#EXTGRP") && pending) {
      pending.group = line.replace("#EXTGRP:", "").trim() || pending.group;
      continue;
    }

    if (line.startsWith("#") || !pending) {
      continue;
    }

    const contentType = getContentType(pending.name, pending.group, line);
    counts[contentType] += 1;

    if (items.length < MAX_STORED_ITEMS) {
      items.push({
        id: `${items.length}-${contentType}-${pending.name}`,
        ...pending,
        url: line,
        contentType,
      });
    }

    pending = undefined;
  }

  return { items, counts };
}

async function parsePlaylistResponse(response: Response) {
  if (!response.body) {
    return parsePlaylist(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const items: IptvItem[] = [];
  const counts: Record<IptvContentType, number> = {
    live: 0,
    movie: 0,
    series: 0,
  };
  let pending:
    | {
        name: string;
        logo?: string;
        group?: string;
        tvgId?: string;
        tvgName?: string;
      }
    | undefined;
  let buffer = "";
  let firstLineChecked = false;

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();

    if (!line) {
      return;
    }

    if (!firstLineChecked) {
      firstLineChecked = true;

      if (!line.startsWith("#EXTM3U")) {
        throw new Error("resposta nao parece M3U");
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

function buildRails(items: IptvItem[], contentType: IptvContentType) {
  const groups = new Map<string, IptvItem[]>();

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
    .map(([title, groupItems]) => ({
      title,
      items: groupItems,
    }));
}

function buildCategories(items: IptvItem[], contentType: IptvContentType) {
  const counts = new Map<string, number>();

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

function isQualityCategory(group: string) {
  const category = normalizeText(group)
    .replace(/^filmes\s*\|\s*/, "")
    .replace(/^series\s*\|\s*/, "")
    .replace(/^serie\s*\|\s*/, "")
    .trim();

  return ["4k", "uhd 4k", "uhd", "fhd", "full hd", "hd", "h265", "hevc"].includes(
    category
  );
}

function prepareCatalogItem(item: IptvItem): IptvItem {
  const searchText = normalizeSearchText(
    `${item.name} ${item.group || ""} ${item.tvgName || ""} ${item.tvgId || ""}`
  );

  return {
    ...item,
    searchText,
    normalizedGroup: normalizeText(item.group || ""),
    normalizedUrl: item.url.toLowerCase(),
    riskyCodec:
      searchText.includes("h265") ||
      searchText.includes("h.265") ||
      searchText.includes("hevc"),
    anime: [
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
    ].some((token) => searchText.includes(token)),
  };
}

function buildSectionItems(items: IptvItem[]): IptvSectionItems {
  return {
    live: items.filter((item) => belongsToSection(item, "live")),
    movie: items.filter((item) => belongsToSection(item, "movie")),
    series: items.filter((item) => belongsToSection(item, "series")),
  };
}

function buildCounts(items: IptvItem[]): Record<IptvContentType, number> {
  return {
    live: items.filter((item) => belongsToSection(item, "live")).length,
    movie: items.filter((item) => belongsToSection(item, "movie")).length,
    series: items.filter((item) => belongsToSection(item, "series")).length,
  };
}

function belongsToSection(item: IptvItem, contentType: IptvContentType) {
  if (contentType === "live") {
    return item.contentType === "live";
  }

  const group = item.normalizedGroup || normalizeText(item.group || "");
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

function isAnimeCatalogItem(item: IptvItem) {
  if (typeof item.anime === "boolean") {
    return item.anime;
  }

  const text = item.searchText || normalizeText(`${item.name} ${item.group || ""}`);
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

function getFilteredItems({
  items,
  type,
  category,
  query,
  includeRiskyCodecs,
  animeOnly,
  excludeAnime,
}: {
  items: IptvItem[];
  type: IptvContentType | "all";
  category: string;
  query: string;
  includeRiskyCodecs: boolean;
  animeOnly?: boolean;
  excludeAnime?: boolean;
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

function hasBrowserRiskyCodec(item: IptvItem) {
  if (typeof item.riskyCodec === "boolean") {
    return item.riskyCodec;
  }

  const text = item.searchText || normalizeText(`${item.name} ${item.group || ""}`);
  return text.includes("h265") || text.includes("h.265") || text.includes("hevc");
}

function decodeXmlValue(value: string) {
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

function getXmlTagValue(block: string, tagName: string) {
  const match = block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlValue(match[1]) : "";
}

function cleanLookupName(value: string) {
  return normalizeText(value)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:fhd|full hd|uhd|4k|hd|sd|h265|h\.265|hevc|dual|dub|dublado|legendado|leg)\b/g, " ")
    .replace(/\b(?:s\d{1,2}e\d{1,3}|temporada\s*\d{1,2}|episodio\s*\d{1,3}|episodio|ep\s*\d{1,3})\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseXmltvDate(value: string) {
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

function parseEpgXml(content: string): EpgCatalog {
  const now = Date.now();
  const channelNames = new Map<string, string[]>();
  const channelPrograms = new Map<string, EpgProgram>();
  const titleDescriptions = new Map<string, EpgProgram>();
  const channelRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
  const programmeRegex = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/gi;
  let channelMatch: RegExpExecArray | null;
  let programmeMatch: RegExpExecArray | null;
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

  return {
    createdAt: now,
    channelPrograms,
    titleDescriptions,
    totalPrograms,
  };
}

function buildEpgSynopsis(item: Partial<IptvItem>, epg?: EpgCatalog) {
  const fallback = buildLocalSynopsis(item);

  if (!epg) {
    return { synopsis: fallback, provider: "local" };
  }

  const lookupNames = [
    item.tvgId,
    item.tvgName,
    item.name,
    cleanLookupName(item.name || "").split(" ").slice(0, 4).join(" "),
  ]
    .filter(Boolean)
    .map((value) => cleanLookupName(String(value)));

  if (item.contentType === "live") {
    const program = lookupNames
      .map((name) => epg.channelPrograms.get(name))
      .find(Boolean);

    if (program) {
      const synopsis = program.desc
        ? `Agora: ${program.title}. ${program.desc}`
        : `Agora no ar: ${program.title}.`;

      return { synopsis, provider: "epg", programme: program.title };
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

function sendJson(response: any, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function readJsonBody(request: any) {
  return new Promise<any>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
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

function buildLocalSynopsis(item: Partial<IptvItem>) {
  const title = item.name || "Este titulo";
  const category = formatCategoryForCopy(item.group || "catalogo");
  const normalizedCategory = normalizeText(category);
  const style = normalizedCategory.includes("romance")
    ? "relacoes, escolhas e conflitos emocionais"
    : normalizedCategory.includes("acao")
      ? "ritmo intenso, perigo e reviravoltas"
      : normalizedCategory.includes("terror")
        ? "suspense, tensao e descobertas sombrias"
        : normalizedCategory.includes("biografia")
          ? "momentos importantes de uma trajetoria marcante"
          : normalizedCategory.includes("comedia")
            ? "situacoes leves e personagens carismaticos"
            : normalizedCategory.includes("anime") || normalizedCategory.includes("animacao")
              ? "aventura, evolucao de personagens e energia visual"
              : "uma selecao feita para quem busca entretenimento direto";

  if (item.contentType === "live") {
    return `${title} e um canal ao vivo da categoria ${category}, pronto para assistir com acesso rapido.`;
  }

  return `${title} traz ${style}. Uma opcao da categoria ${category}, organizada para assistir agora ou salvar na sua lista.`;
}

async function pipeResponse(upstream: Response, response: any) {
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

function rewriteHlsManifest(content: string, baseUrl: string) {
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

function getStreamHeaders(range: string | string[] | undefined) {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 IPTV Player",
  };

  if (typeof range === "string" && range) {
    headers.Range = range;
  }

  return headers;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const playlistUrls = [
    env.VITE_APP_IPTV_PLAYLIST_URL,
    env.VITE_APP_IPTV_M3U_URL,
    env.VITE_APP_IPTV_SSIPTV_URL,
  ].filter(Boolean);
  const epgUrl = env.VITE_APP_IPTV_EPG_URL;

  let cache:
    | {
        createdAt: number;
        items: IptvItem[];
        sectionItems: IptvSectionItems;
        counts: Record<IptvContentType, number>;
        categories: Record<IptvContentType, IptvCategory[]>;
        rails: Record<IptvContentType, IptvRail[]>;
      }
    | undefined;
  let loadingPromise: Promise<NonNullable<typeof cache>> | undefined;
  let epgCache: EpgCatalog | undefined;
  let epgLoadingPromise: Promise<EpgCatalog | undefined> | undefined;

  async function loadEpg() {
    if (epgCache && Date.now() - epgCache.createdAt < EPG_TTL_MS) {
      return epgCache;
    }

    if (epgLoadingPromise) {
      return epgLoadingPromise;
    }

    epgLoadingPromise = (async () => {
      try {
        const localContent = await readFile("public/epg/epg.xml", "utf-8");
        epgCache = parseEpgXml(localContent);
        return epgCache;
      } catch {
        if (!epgUrl) {
          return undefined;
        }
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PLAYLIST_FETCH_TIMEOUT_MS);

        try {
          const response = await fetch(epgUrl, {
            signal: controller.signal,
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
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        return undefined;
      }
    })().finally(() => {
      epgLoadingPromise = undefined;
    });

    return epgLoadingPromise;
  }

  async function loadCatalog() {
    if (cache && Date.now() - cache.createdAt < CATALOG_TTL_MS) {
      return cache;
    }

    if (loadingPromise) {
      return loadingPromise;
    }

    loadingPromise = (async () => {
      let lastError = "";

      for (const playlistUrl of playlistUrls) {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          PLAYLIST_FETCH_TIMEOUT_MS
        );

        try {
          const response = await fetch(playlistUrl, {
            signal: controller.signal,
            headers: {
              Accept:
                "application/x-mpegURL, application/vnd.apple.mpegurl, text/plain, */*",
              "User-Agent": "Mozilla/5.0 IPTV Player",
            },
          });

          if (!response.ok) {
            lastError = `${playlistUrl}: HTTP ${response.status}`;
            continue;
          }

          const parsed = await parsePlaylistResponse(response);
          const preparedItems = parsed.items.map(prepareCatalogItem);
          const sectionItems = buildSectionItems(preparedItems);
          const parsedTotal =
            parsed.counts.live + parsed.counts.movie + parsed.counts.series;
          const looksLikeDirectoryOnly =
            parsed.items.length > 0 &&
            parsed.items.every((item) => {
              const itemUrl = item.url.toLowerCase();
              return (
                itemUrl.includes("/list_lives/") ||
                itemUrl.includes("/list_movies/") ||
                itemUrl.includes("_categories/") ||
                itemUrl.includes("/movie_categories/") ||
                itemUrl.includes("/serie_categories/")
              );
            });

          if (parsedTotal < 10 || looksLikeDirectoryOnly) {
            lastError = `${playlistUrl}: lista sem conteudo reproduzivel`;
            continue;
          }

          cache = {
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

          return cache;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : "falha ao carregar lista";
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new Error(lastError || "Nenhuma lista IPTV respondeu.");
    })().finally(() => {
      loadingPromise = undefined;
    });

    return loadingPromise;
  }

  return {
    plugins: [
      react(),
      tsconfigPaths(),
      {
        name: "iptv-local-api",
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            const requestPath = request.url?.split("?")[0] || "/";
            const acceptsHtml = String(request.headers.accept || "").includes(
              "text/html"
            );
            const isAppRoute =
              request.method === "GET" &&
              acceptsHtml &&
              !requestPath.startsWith("/api/") &&
              !requestPath.includes(".");

            if (isAppRoute) {
              const html = await readFile("index.html", "utf-8");
              response.statusCode = 200;
              response.setHeader("Content-Type", "text/html; charset=utf-8");
              response.end(await server.transformIndexHtml(requestPath, html));
              return;
            }

            if (
              !request.url?.startsWith("/api/iptv") &&
              !request.url?.startsWith("/api/epg")
            ) {
              next();
              return;
            }

            try {
              const url = new URL(request.url, "http://localhost");

              if (url.pathname === "/api/epg/synopsis") {
                const body = await readJsonBody(request);
                const item = (body?.item || body || {}) as Partial<IptvItem>;
                const epg = await loadEpg();
                const result = buildEpgSynopsis(item, epg);

                sendJson(response, 200, result);
                return;
              }

              const catalog = await loadCatalog();

              if (url.pathname === "/api/iptv/catalog") {
                sendJson(response, 200, {
                  counts: catalog.counts,
                  categories: catalog.categories,
                  rails: catalog.rails,
                  featured:
                    catalog.items.find(
                      (item) =>
                        item.contentType === "live" &&
                        !hasBrowserRiskyCodec(item)
                    ) ||
                    catalog.items.find((item) => item.contentType === "live") ||
                    catalog.items[0] ||
                    null,
                  cachedAt: catalog.createdAt,
                });
                return;
              }

              if (url.pathname === "/api/iptv/items") {
                const type = (url.searchParams.get("type") || "live") as
                  | IptvContentType
                  | "all";
                const category = url.searchParams.get("category") || "Todos";
                const query = url.searchParams.get("q") || "";
                const includeRiskyCodecs =
                  url.searchParams.get("includeRiskyCodecs") === "1";
                const animeOnly = url.searchParams.get("animeOnly") === "1";
                const excludeAnime = url.searchParams.get("excludeAnime") === "1";
                const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
                const pageSize = Math.min(
                  Math.max(Number(url.searchParams.get("pageSize") || 72), 24),
                  120
                );
                const sourceItems =
                  type === "all" ? catalog.items : catalog.sectionItems[type];
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
                const pagedItems = filteredItems.slice(start, start + pageSize);

                sendJson(response, 200, {
                  items: pagedItems,
                  total: filteredItems.length,
                  page,
                  pageSize,
                  hasMore: start + pageSize < filteredItems.length,
                });
                return;
              }

              if (url.pathname === "/api/iptv/search") {
                const query = normalizeSearchText(url.searchParams.get("q") || "");
                const type = url.searchParams.get("type") as
                  | IptvContentType
                  | "all"
                  | null;

                const results = catalog.items
                  .map((item) => ({
                    item,
                    searchScore: query ? getFuzzySearchScore(item, query) : 1,
                  }))
                  .filter(({ item, searchScore }) => {
                    const matchesType =
                      !type || type === "all" || item.contentType === type;
                    const matchesQuery = !query || searchScore > 0;

                    return matchesType && matchesQuery;
                  })
                  .sort((a, b) => b.searchScore - a.searchScore)
                  .map(({ item }) => item)
                  .slice(0, 120);

                sendJson(response, 200, { results });
                return;
              }

              if (url.pathname === "/api/iptv/stream") {
                const id = url.searchParams.get("id");
                const item = catalog.items.find((catalogItem) => {
                  return catalogItem.id === id;
                });

                if (!item) {
                  sendJson(response, 404, { error: "Item nao encontrado." });
                  return;
                }

                const upstream = await fetch(item.url, {
                  headers: getStreamHeaders(request.headers.range),
                });
                const contentType = upstream.headers.get("content-type") || "";

                if (
                  item.url.toLowerCase().includes(".m3u8") ||
                  contentType.includes("mpegurl")
                ) {
                  const manifest = await upstream.text();
                  response.statusCode = upstream.status;
                  response.setHeader(
                    "Content-Type",
                    "application/vnd.apple.mpegurl; charset=utf-8"
                  );
                  response.setHeader("Access-Control-Allow-Origin", "*");
                  response.end(rewriteHlsManifest(manifest, item.url));
                  return;
                }

                await pipeResponse(upstream, response);
                return;
              }

              if (url.pathname === "/api/iptv/proxy") {
                const targetUrl = url.searchParams.get("url");

                if (!targetUrl) {
                  sendJson(response, 400, { error: "URL ausente." });
                  return;
                }

                const upstream = await fetch(targetUrl, {
                  headers: getStreamHeaders(request.headers.range),
                });
                const contentType = upstream.headers.get("content-type") || "";

                if (
                  targetUrl.toLowerCase().includes(".m3u8") ||
                  contentType.includes("mpegurl")
                ) {
                  const manifest = await upstream.text();
                  response.statusCode = upstream.status;
                  response.setHeader(
                    "Content-Type",
                    "application/vnd.apple.mpegurl; charset=utf-8"
                  );
                  response.setHeader("Access-Control-Allow-Origin", "*");
                  response.end(rewriteHlsManifest(manifest, targetUrl));
                  return;
                }

                await pipeResponse(upstream, response);
                return;
              }

              sendJson(response, 404, { error: "Rota IPTV nao encontrada." });
            } catch (error) {
              sendJson(response, 500, {
                error:
                  error instanceof Error
                    ? error.message
                    : "Erro ao carregar IPTV.",
              });
            }
          });
        },
      },
    ],
  };
});
