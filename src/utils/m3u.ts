import { IptvChannel, IptvContentType } from "src/types/Iptv";

const ATTRIBUTE_REGEX = /([\w-]+)="([^"]*)"/g;
type ParseOptions = {
  batchSize?: number;
  maxItemsByType?: Partial<Record<IptvContentType, number>>;
};

function parseAttributes(line: string) {
  const attributes: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = ATTRIBUTE_REGEX.exec(line)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function parseChannelName(line: string, attributes: Record<string, string>) {
  const commaIndex = line.lastIndexOf(",");
  const fallbackName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";

  return (
    attributes["tvg-name"] ||
    attributes.name ||
    fallbackName ||
    "Canal sem nome"
  );
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferContentType({
  name,
  group,
  url,
}: {
  name: string;
  group?: string;
  url: string;
}): IptvContentType {
  const normalizedUrl = url.toLowerCase();
  const normalizedText = normalizeSearchText(`${group || ""} ${name}`);

  if (
    normalizedUrl.includes("/series/") ||
    /\bs\d{1,2}\s*e\d{1,3}\b/i.test(name) ||
    normalizedText.includes("series") ||
    normalizedText.includes("serie") ||
    normalizedText.includes("temporada") ||
    normalizedText.includes("episodio")
  ) {
    return "series";
  }

  if (
    normalizedUrl.includes("/movie/") ||
    normalizedText.includes("filmes") ||
    normalizedText.includes("filme") ||
    normalizedText.includes("movies") ||
    normalizedText.includes("movie") ||
    normalizedText.includes("cinema") ||
    normalizedText.includes("vod") ||
    normalizedText.includes("lancamento")
  ) {
    return "movie";
  }

  return "live";
}

function createM3uLineParser(options: ParseOptions = {}) {
  const channels: IptvChannel[] = [];
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

  const consumeLine = (rawLine: string) => {
    const line = rawLine.trim();

    if (!line) {
      return undefined;
    }

    if (line.startsWith("#EXTINF")) {
      const attributes = parseAttributes(line);
      pending = {
        name: parseChannelName(line, attributes),
        logo: attributes["tvg-logo"],
        group: attributes["group-title"] || "Sem categoria",
        tvgId: attributes["tvg-id"],
        tvgName: attributes["tvg-name"],
      };
      return undefined;
    }

    if (line.startsWith("#EXTGRP") && pending) {
      pending.group = line.replace("#EXTGRP:", "").trim() || pending.group;
      return undefined;
    }

    if (line.startsWith("#")) {
      return undefined;
    }

    if (pending) {
      const contentType = inferContentType({ ...pending, url: line });
      const maxItems = options.maxItemsByType?.[contentType];
      const channel = {
        ...pending,
        id: `${channels.length}-${pending.tvgId || pending.name}`,
        url: line,
        contentType,
      };

      pending = undefined;

      if (maxItems !== undefined && counts[contentType] >= maxItems) {
        return undefined;
      }

      counts[contentType] += 1;
      channels.push(channel);
      return channel;
    }

    return undefined;
  };

  return {
    channels,
    consumeLine,
  };
}

export function parseM3uPlaylist(
  content: string,
  options: ParseOptions = {}
): IptvChannel[] {
  const parser = createM3uLineParser(options);
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    parser.consumeLine(line);
  }

  return parser.channels;
}

export async function parseM3uPlaylistFromResponse(
  response: Response,
  onBatch: (channels: IptvChannel[]) => void,
  options: ParseOptions = {}
) {
  const batchSize = options.batchSize || 400;
  const parser = createM3uLineParser(options);
  const reader = response.body?.getReader();
  let batch: IptvChannel[] = [];

  const flushBatch = () => {
    if (!batch.length) {
      return;
    }

    onBatch(batch);
    batch = [];
  };

  if (!reader) {
    const channels = parseM3uPlaylist(await response.text(), options);
    onBatch(channels);
    return channels;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : lines.pop() || "";

    for (const line of lines) {
      const channel = parser.consumeLine(line);

      if (channel) {
        batch.push(channel);
      }

      if (batch.length >= batchSize) {
        flushBatch();
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer) {
    const channel = parser.consumeLine(buffer);

    if (channel) {
      batch.push(channel);
    }
  }

  flushBatch();
  return parser.channels;
}
