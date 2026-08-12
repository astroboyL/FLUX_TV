import { useEffect, useMemo, useRef, useState } from "react";
import Player from "video.js/dist/types/player";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import MovieIcon from "@mui/icons-material/Movie";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import TvIcon from "@mui/icons-material/Tv";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";

import VideoJSPlayer from "src/components/watch/VideoJSPlayer";
import { IptvChannel, IptvContentType } from "src/types/Iptv";

type SectionType = IptvContentType | "anime" | "favorites";
type QualityFilter = "all" | "sd" | "hd" | "fhd" | "4k";
type SortFilter = "smart" | "popular" | "az";

type IptvCategory = {
  name: string;
  count: number;
};

type IptvCatalog = {
  counts: Record<IptvContentType, number>;
  categories: Record<IptvContentType, IptvCategory[]>;
  featured: IptvChannel | null;
};

type PlaybackSettings = {
  playOnCardClick: boolean;
  mutedStart: boolean;
  volume: number;
  compactCards: boolean;
  showRiskyCodecs: boolean;
  previewOnHover: boolean;
};

type PlaybackProgress = Record<
  string,
  {
    time: number;
    duration: number;
    updatedAt: string;
  }
>;

const STORAGE_KEYS = {
  favorites: "flux-favorites",
  liked: "flux-liked",
  recent: "flux-recent",
  watchCounts: "flux-watch-counts",
  settings: "flux-settings",
  progress: "flux-progress",
};

const DEFAULT_SETTINGS: PlaybackSettings = {
  playOnCardClick: true,
  mutedStart: false,
  volume: 0.85,
  compactCards: false,
  showRiskyCodecs: false,
  previewOnHover: false,
};

const SECTIONS: { value: SectionType; label: string }[] = [
  { value: "live", label: "Canais" },
  { value: "movie", label: "Filmes" },
  { value: "series", label: "Séries" },
  { value: "anime", label: "Animes" },
];

const SORT_FILTERS: { value: SortFilter; label: string }[] = [
  { value: "smart", label: "Recomendados" },
  { value: "popular", label: "Mais vistos" },
  { value: "az", label: "A-Z" },
];

const SECTION_HASHES: Record<Exclude<SectionType, "favorites">, string> = {
  live: "canais",
  movie: "filmes",
  series: "series",
  anime: "animes",
};

const RECOMMENDATION_STOPWORDS = new Set([
  "a",
  "as",
  "ao",
  "da",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "hd",
  "fhd",
  "filme",
  "filmes",
  "serie",
  "series",
  "the",
  "um",
  "uma",
]);

function readStorage<T>(key: string, fallback: T) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function readJsonResponse<T>(response: Response, fallbackError: string) {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    throw new Error(`${fallbackError}: HTTP ${response.status}`);
  }

  if (!contentType.includes("application/json")) {
    const preview = (await response.text()).slice(0, 80);
    throw new Error(
      `${fallbackError}: a API retornou ${contentType || "conteudo invalido"} (${preview})`
    );
  }

  return (await response.json()) as T;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCategory(value: string) {
  const plainValue = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  return plainValue
    .replace(/^CANAIS\s*\|\s*/i, "")
    .replace(/^FILMES\s*\|\s*/i, "")
    .replace(/^SERIES\s*\|\s*/i, "")
    .replace(/^S(?:E|É)RIES\s*\|\s*/i, "")
    .trim();
}

function getVideoType(url: string) {
  return url.toLowerCase().includes(".m3u8")
    ? "application/x-mpegURL"
    : "video/mp4";
}

function getTypeLabel(type?: IptvContentType) {
  if (type === "movie") {
    return "Filme";
  }

  if (type === "series") {
    return "Série";
  }

  return "Canal";
}

function getTypeIcon(type?: IptvContentType) {
  if (type === "movie") {
    return <MovieIcon />;
  }

  if (type === "series") {
    return <TvIcon />;
  }

  return <LiveTvIcon />;
}

function hasBrowserRiskyCodec(item?: IptvChannel | null) {
  const text = normalize(`${item?.name || ""} ${item?.group || ""}`);
  return text.includes("h265") || text.includes("h.265") || text.includes("hevc");
}

function uniqById(items: IptvChannel[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function filterLocalItems(items: IptvChannel[], query: string) {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return items;
  }

  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length > 1);

  return items.filter((item) => {
    const searchText = normalize(`${item.name} ${item.group || ""}`);

    if (searchText.includes(normalizedQuery)) {
      return true;
    }

    const candidateTokens = searchText.split(" ").filter(Boolean);
    const matches = queryTokens.filter((queryToken) =>
      candidateTokens.some(
        (candidateToken) =>
          candidateToken.includes(queryToken) ||
          queryToken.includes(candidateToken) ||
          (queryToken.length > 3 &&
            candidateToken.length > 3 &&
            candidateToken[0] === queryToken[0] &&
            Math.abs(candidateToken.length - queryToken.length) <= 2)
      )
    );

    return matches.length >= Math.max(1, Math.ceil(queryTokens.length * 0.6));
  });
}

function asItemList(value: unknown) {
  return Array.isArray(value) ? (value as IptvChannel[]) : [];
}

function getApiType(section: SectionType): IptvContentType {
  return section === "anime" ? "series" : section === "favorites" ? "series" : section;
}

function getSectionFromHash(hash: string): SectionType {
  const cleanHash = hash.replace("#", "").toLowerCase();

  if (cleanHash === "filmes") {
    return "movie";
  }

  if (cleanHash === "series") {
    return "series";
  }

  if (cleanHash === "animes") {
    return "anime";
  }

  return "live";
}

function getSectionHash(section: SectionType) {
  return SECTION_HASHES[section === "favorites" ? "live" : section];
}

function isAnimeItem(item: IptvChannel) {
  const text = normalize(`${item.name} ${item.group || ""}`);
  return [
    "anime",
    "animes",
    "animacao",
    "animation",
    "crunchyroll",
    "manga",
    "mangá",
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

function cleanSeriesTitle(name: string) {
  const episodeMarker = name.search(
    /(?:\s+-\s*)?(?:S(?:eason)?\s*\d{1,2}\s*E(?:p(?:isode)?)?\s*\d{1,3}|\d{1,2}\s*x\s*\d{1,3}|temporada\s*\d{1,2}|temp\s*\d{1,2}|epis\S*\s*\d{1,3}|ep\s*\d{1,3})/i
  );
  const baseName = episodeMarker > 0 ? name.slice(0, episodeMarker) : name;

  return baseName
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*(?:dub|leg|hd|fhd|4k|h265|hevc)[^)]*\)/gi, " ")
    .replace(/\bS(?:eason)?\s*\d{1,2}\s*E(?:p(?:isode)?)?\s*\d{1,3}\b/gi, " ")
    .replace(/\b\d{1,2}\s*x\s*\d{1,3}\b/gi, " ")
    .replace(/\b(?:temporada|temp|t)\s*\d{1,2}\b/gi, " ")
    .replace(/\b(?:episodio|episódio|ep|e)\s*\d{1,3}\b/gi, " ")
    .replace(/\bep\S*\s*\d{1,3}\b/gi, " ")
    .replace(/\b(?:dub|dublado|legendado|leg|hd|fhd|4k|h265|hevc)\b/gi, " ")
    .replace(/\s+-\s*(?:-|$)/g, " ")
    .replace(/[-_:|]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSeriesCatalogKey(item: IptvChannel) {
  const cleanTitle = cleanSeriesTitle(item.name) || item.name;
  const logoKey = item.logo ? normalize(item.logo) : "";

  if (logoKey && (item.name !== cleanTitle || item.name.length > 42)) {
    return `${logoKey} ${normalize(item.group || "")}`;
  }

  return normalize(`${cleanTitle} ${item.group || ""}`);
}

function getSectionLabel(section: SectionType) {
  return SECTIONS.find((item) => item.value === section)?.label || "Catalogo";
}

function isLaunchCategoryName(value: string) {
  const category = normalize(formatCategory(value));

  return (
    category.includes("lanc") ||
    category.includes("novidade") ||
    category.includes("estreia") ||
    category.includes("recent")
  );
}

function orderCategoriesForSection(
  categories: IptvCategory[],
  section: SectionType
) {
  if (section !== "movie") {
    return categories;
  }

  const allCategory = categories.find((category) => category.name === "Todos");
  const orderedCategories = categories
    .filter((category) => category.name !== "Todos")
    .sort((categoryA, categoryB) => {
      const categoryALaunch = isLaunchCategoryName(categoryA.name);
      const categoryBLaunch = isLaunchCategoryName(categoryB.name);

      if (categoryALaunch !== categoryBLaunch) {
        return categoryALaunch ? -1 : 1;
      }

      return formatCategory(categoryA.name).localeCompare(formatCategory(categoryB.name));
    });

  return allCategory ? [allCategory, ...orderedCategories] : orderedCategories;
}

function matchesSection(item: IptvChannel, section: SectionType) {
  if (section === "favorites") {
    return true;
  }

  if (section === "anime") {
    return item.contentType === "series" && isAnimeItem(item);
  }

  if (section === "series") {
    return item.contentType === "series" && !isAnimeItem(item);
  }

  return item.contentType === section;
}

function catalogItemsForSection(items: IptvChannel[], section: SectionType) {
  const sectionItems = items.filter((item) => matchesSection(item, section));

  if (section !== "series" && section !== "anime") {
    return uniqById(sectionItems);
  }

  const cataloged = new Map<string, IptvChannel>();

  sectionItems.forEach((item) => {
    const cleanTitle = cleanSeriesTitle(item.name) || item.name;
    const key = getSeriesCatalogKey(item);
    const current = cataloged.get(key);

    if (!current || (!current.logo && item.logo)) {
      cataloged.set(key, {
        ...item,
        name: cleanTitle,
      });
    }
  });

  return [...cataloged.values()];
}

function buildSmartSynopsis(item: IptvChannel) {
  const category = formatCategory(item.group || "catalogo");
  const normalizedCategory = normalize(category);

  if (item.contentType === "live") {
    return `${item.name} transmite conteudo ao vivo da categoria ${category}, com acesso rapido para assistir agora ou salvar nos favoritos.`;
  }

  const tone = normalizedCategory.includes("romance")
    ? "uma historia guiada por encontros, escolhas e sentimentos fortes"
    : normalizedCategory.includes("acao")
      ? "uma trama de ritmo intenso, conflitos diretos e momentos de alta tensao"
      : normalizedCategory.includes("terror")
        ? "uma experiencia de suspense, medo e descobertas sombrias"
        : normalizedCategory.includes("biografia")
          ? "um retrato de vida marcado por decisoes, desafios e acontecimentos importantes"
          : normalizedCategory.includes("comedia")
            ? "uma jornada leve, com situacoes divertidas e personagens carismaticos"
            : normalizedCategory.includes("drama")
              ? "uma narrativa emocional sobre conflitos pessoais e consequencias profundas"
              : "uma selecao escolhida dentro do catalogo para combinar com o genero selecionado";

  return `${item.name} apresenta ${tone}. Salve na sua lista ou veja titulos semelhantes dentro da mesma categoria.`;
}

function parseEpisodeInfo(item: IptvChannel) {
  const text = normalize(item.name);
  const directMatch =
    text.match(/\bs(?:eason)?\s*(\d{1,2})\s*e(?:p(?:isode)?)?\s*(\d{1,3})\b/) ||
    text.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\b/);
  const seasonEpisodeMatch = text.match(
    /\b(?:temporada|temp|t)\s*(\d{1,2}).*?\b(?:episodio|ep|e)\s*(\d{1,3})\b/
  );
  const episodeOnlyMatch = text.match(/\b(?:episodio|ep|e)\s*(\d{1,3})\b/);
  const match = directMatch || seasonEpisodeMatch;

  return {
    season: Number(match?.[1] || 1),
    episode: Number(match?.[2] || episodeOnlyMatch?.[1] || 1),
    title: cleanSeriesTitle(item.name) || item.name,
  };
}

function buildEpisodeCatalog(item: IptvChannel, pool: IptvChannel[]) {
  const base = normalize(cleanSeriesTitle(item.name) || item.name);
  const candidates = uniqById([item, ...pool]).filter((candidate) => {
    if (candidate.contentType !== "series") {
      return false;
    }

    const candidateTitle = normalize(cleanSeriesTitle(candidate.name) || candidate.name);

    return (
      candidate.id === item.id ||
      candidateTitle === base ||
      Boolean(base && candidateTitle.includes(base))
    );
  });

  const seasons = new Map<number, IptvChannel[]>();
  candidates.forEach((candidate) => {
    const episodeInfo = parseEpisodeInfo(candidate);
    const currentSeason = seasons.get(episodeInfo.season) || [];
    currentSeason.push(candidate);
    seasons.set(episodeInfo.season, currentSeason);
  });

  return [...seasons.entries()]
    .sort(([seasonA], [seasonB]) => seasonA - seasonB)
    .map(([season, seasonItems]) => ({
      season,
      episodes: seasonItems.sort(
        (a, b) => parseEpisodeInfo(a).episode - parseEpisodeInfo(b).episode
      ),
    }));
}

function getQuality(item: IptvChannel): QualityFilter {
  const text = normalize(`${item.name} ${item.group || ""}`);

  if (text.includes("4k") || text.includes("uhd")) {
    return "4k";
  }

  if (text.includes("fhd") || text.includes("full hd") || text.includes("1080")) {
    return "fhd";
  }

  if (text.includes("hd") || text.includes("720")) {
    return "hd";
  }

  return "sd";
}

function getRecommendationTokens(item: IptvChannel) {
  return normalize(`${item.name} ${item.group || ""}`)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !RECOMMENDATION_STOPWORDS.has(token));
}

function buildTasteProfile({
  favoriteItems,
  recentItems,
  watchCounts,
}: {
  favoriteItems: IptvChannel[];
  recentItems: IptvChannel[];
  watchCounts: Record<string, number>;
}) {
  const groups = new Map<string, number>();
  const tokens = new Map<string, number>();
  const types = new Map<IptvContentType, number>();
  const likedItems = uniqById([...favoriteItems, ...recentItems]);

  likedItems.forEach((item, index) => {
    const recencyWeight = Math.max(1, 12 - index * 0.22);
    const favoriteWeight = favoriteItems.some((favorite) => favorite.id === item.id)
      ? 9
      : 0;
    const watchWeight = Math.min(watchCounts[item.id] || 0, 10) * 2.5;
    const weight = recencyWeight + favoriteWeight + watchWeight;
    const groupKey = normalize(item.group || "Sem categoria");

    groups.set(groupKey, (groups.get(groupKey) || 0) + weight);
    types.set(item.contentType, (types.get(item.contentType) || 0) + weight);

    getRecommendationTokens(item).forEach((token) => {
      tokens.set(token, (tokens.get(token) || 0) + weight * 0.45);
    });
  });

  return { groups, tokens, types, hasTaste: likedItems.length > 0 };
}

function getSmartScore({
  item,
  favoriteIds,
  profile,
  watchCounts,
}: {
  item: IptvChannel;
  favoriteIds: string[];
  profile: ReturnType<typeof buildTasteProfile>;
  watchCounts: Record<string, number>;
}) {
  const groupScore = profile.groups.get(normalize(item.group || "Sem categoria")) || 0;
  const typeScore = profile.types.get(item.contentType) || 0;
  const tokenScore = getRecommendationTokens(item).reduce(
    (score, token) => score + (profile.tokens.get(token) || 0),
    0
  );

  return (
    groupScore * 1.4 +
    typeScore * 0.5 +
    tokenScore +
    (watchCounts[item.id] || 0) * 8 +
    (favoriteIds.includes(item.id) ? 40 : 0) +
    (item.logo ? 2 : 0) +
    (getQuality(item) === "4k" ? 5 : 0) +
    (getQuality(item) === "fhd" ? 3 : 0) -
    (hasBrowserRiskyCodec(item) ? 60 : 0)
  );
}

function sortItems({
  items,
  sort,
  favoriteIds,
  profile,
  watchCounts,
}: {
  items: IptvChannel[];
  sort: SortFilter;
  favoriteIds: string[];
  profile: ReturnType<typeof buildTasteProfile>;
  watchCounts: Record<string, number>;
}) {
  const sortedItems = [...items];

  if (sort === "az") {
    return sortedItems.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (sort === "popular") {
    return sortedItems.sort(
      (a, b) => (watchCounts[b.id] || 0) - (watchCounts[a.id] || 0)
    );
  }

  return sortedItems.sort(
    (a, b) =>
      getSmartScore({ item: b, favoriteIds, profile, watchCounts }) -
      getSmartScore({ item: a, favoriteIds, profile, watchCounts })
  );
}

function getHeroArtwork(item?: IptvChannel | null) {
  if (!item?.logo) {
    return "";
  }

  return `url("${item.logo}")`;
}

function SettingsDialog({
  open,
  settings,
  onClose,
  onChange,
}: {
  open: boolean;
  settings: PlaybackSettings;
  onClose: () => void;
  onChange: (settings: PlaybackSettings) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          bgcolor: "#181818",
        }}
      >
        Reproducao
        <IconButton color="inherit" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: "#181818" }}>
        <Stack spacing={2.25} sx={{ pt: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.playOnCardClick}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    playOnCardClick: event.target.checked,
                  })
                }
              />
            }
            label="Tocar ao clicar no card"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.mutedStart}
                onChange={(event) =>
                  onChange({ ...settings, mutedStart: event.target.checked })
                }
              />
            }
            label="Iniciar sem som"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.compactCards}
                onChange={(event) =>
                  onChange({ ...settings, compactCards: event.target.checked })
                }
              />
            }
            label="Cards compactos"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.previewOnHover}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    previewOnHover: event.target.checked,
                  })
                }
              />
            }
            label="Previa ao passar o mouse"
          />
          <FormControlLabel
            control={
              <Switch
                checked={settings.showRiskyCodecs}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    showRiskyCodecs: event.target.checked,
                  })
                }
              />
            }
            label="Mostrar H265/HEVC"
          />
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <VolumeUpIcon fontSize="small" />
              <Typography variant="body2">Volume padrao</Typography>
            </Stack>
            <Slider
              value={Math.round(settings.volume * 100)}
              onChange={(_, value) =>
                onChange({ ...settings, volume: (value as number) / 100 })
              }
              min={0}
              max={100}
            />
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function MediaThumb({ item }: { item: IptvChannel }) {
  return item.logo ? (
    <Box
      component="img"
      src={item.logo}
      alt={item.name}
      loading="lazy"
      sx={{
        width: "100%",
        height: "100%",
        objectFit: item.contentType === "live" ? "contain" : "cover",
        p: item.contentType === "live" ? 2 : 0,
      }}
    />
  ) : (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        color: "grey.500",
        background: "linear-gradient(135deg, #252525, #111)",
      }}
    >
      {getTypeIcon(item.contentType)}
    </Box>
  );
}

function MediaCard({
  item,
  selected,
  favorite,
  compact,
  rank,
  grid,
  progress,
  enablePreview,
  onPlay,
  onFavorite,
}: {
  item: IptvChannel;
  selected: boolean;
  favorite: boolean;
  compact: boolean;
  rank?: number;
  grid?: boolean;
  progress?: { time: number; duration: number };
  enablePreview: boolean;
  onPlay: () => void;
  onFavorite: () => void;
}) {
  const isLive = item.contentType === "live";
  const hoverTimerRef = useRef<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const canPreview = enablePreview && !isLive && !hasBrowserRiskyCodec(item);
  const progressPercent =
    progress?.duration && progress.duration > 0
      ? Math.min(100, Math.max(0, (progress.time / progress.duration) * 100))
      : 0;

  useEffect(
    () => () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
    },
    []
  );

  const startHoverPreview = () => {
    if (!canPreview) {
      return;
    }

    hoverTimerRef.current = window.setTimeout(() => {
      setPreviewing(true);
    }, 720);
  };

  const stopHoverPreview = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    setPreviewing(false);
  };

  return (
    <Box
      onMouseEnter={startHoverPreview}
      onMouseLeave={stopHoverPreview}
      onFocus={startHoverPreview}
      onBlur={stopHoverPreview}
      sx={{
        width: grid
          ? "100%"
          : rank
          ? { xs: 220, sm: 260, md: 300 }
          : isLive
            ? { xs: 188, sm: 220, md: 248 }
            : { xs: 138, sm: 164, md: 188 },
        flex: grid ? "initial" : "0 0 auto",
        scrollSnapAlign: "start",
        position: "relative",
      }}
    >
      {rank && (
        <Typography
          aria-hidden
          sx={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 0,
            fontSize: { xs: 128, sm: 158, md: 186 },
            lineHeight: 0.8,
            fontWeight: 900,
            color: "rgba(0,0,0,0.62)",
            WebkitTextStroke: "3px rgba(255,255,255,0.32)",
            pointerEvents: "none",
          }}
        >
          {rank}
        </Typography>
      )}
      <Box
        sx={{
          position: "relative",
          ml: rank ? { xs: 8, sm: 10, md: 12 } : 0,
          borderRadius: 1,
          overflow: "hidden",
          bgcolor: "#181818",
          border: selected
            ? "2px solid #e42c36"
            : "1px solid rgba(255,255,255,0.08)",
          transition:
            "transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
          "&:hover": {
            transform: { sm: "scale(1.055)" },
            zIndex: 3,
            borderColor: "rgba(255,255,255,0.35)",
            boxShadow: "0 18px 42px rgba(0,0,0,0.55)",
          },
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={onPlay}
          sx={{
            width: "100%",
            p: 0,
            border: 0,
            display: "block",
            bgcolor: "#222",
            cursor: "pointer",
            aspectRatio: isLive ? "16 / 9" : "2 / 3",
            overflow: "hidden",
          }}
        >
          <MediaThumb item={item} />
          {previewing && (
            <Box
              component="video"
              src={`/api/iptv/stream?id=${encodeURIComponent(item.id)}`}
              muted
              autoPlay
              playsInline
              loop
              preload="metadata"
              onError={() => setPreviewing(false)}
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: isLive ? "contain" : "cover",
                bgcolor: "#000",
              }}
            />
          )}
        </Box>

        {isLive && (
          <Chip
            size="small"
            label="LIVE"
            sx={{
              position: "absolute",
              left: 8,
              top: 8,
              height: 21,
              bgcolor: "#e42c36",
              color: "common.white",
              fontWeight: 900,
              borderRadius: 0.5,
            }}
          />
        )}

        {progressPercent > 2 && !isLive && (
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 4,
              bgcolor: "rgba(255,255,255,0.18)",
            }}
          >
            <Box
              sx={{
                width: `${progressPercent}%`,
                height: "100%",
                bgcolor: "#e42c36",
              }}
            />
          </Box>
        )}
      </Box>

        <Box
          sx={{
            mt: 0.8,
            minHeight: compact ? 34 : 44,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Typography
              variant="body2"
              title={item.name}
              sx={{
                flex: 1,
                minWidth: 0,
                fontWeight: 800,
                color: "grey.100",
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: compact ? 1 : 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {item.name}
            </Typography>
            <IconButton
              size="small"
              onClick={onFavorite}
              sx={{
                width: 30,
                height: 30,
                color: favorite ? "#fff" : "grey.200",
                bgcolor: favorite ? "#e42c36" : "rgba(0,0,0,0.58)",
                "&:hover": { bgcolor: favorite ? "#f0444d" : "rgba(0,0,0,0.78)" },
              }}
            >
              {favorite ? <BookmarkIcon fontSize="small" /> : <AddIcon fontSize="small" />}
            </IconButton>
          </Stack>
        </Box>
    </Box>
  );
}

function MediaRail({
  title,
  subtitle,
  items,
  favoriteIds,
  compact,
  selectedId,
  ranked,
  playbackProgress,
  enablePreview,
  onPlay,
  onFavorite,
}: {
  title: string;
  subtitle?: string;
  items: IptvChannel[];
  favoriteIds: string[];
  compact: boolean;
  selectedId?: string;
  ranked?: boolean;
  playbackProgress?: PlaybackProgress;
  enablePreview: boolean;
  onPlay: (item: IptvChannel) => void;
  onFavorite: (item: IptvChannel) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  if (!items.length) {
    return null;
  }

  const scrollRail = (direction: -1 | 1) => {
    const rail = railRef.current;

    if (!rail) {
      return;
    }

    rail.scrollBy({
      left: direction * Math.round(rail.clientWidth * 0.82),
      behavior: "smooth",
    });
  };

  return (
    <Box sx={{ position: "relative", width: "100%" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.2}
        sx={{ mb: 1 }}
      >
        <Stack direction="row" alignItems="baseline" spacing={1.2} sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography
              variant="body2"
              noWrap
              sx={{ color: "grey.500", display: { xs: "none", sm: "block" } }}
            >
              {subtitle}
            </Typography>
          )}
        </Stack>
        <Stack
          direction="row"
          spacing={0.75}
          sx={{ display: { xs: "none", md: "flex" } }}
        >
          <Stack direction="row" spacing={0.35} alignItems="center" sx={{ mr: 0.5 }}>
            {[0, 1, 2, 3, 4].map((dot) => (
              <Box
                key={dot}
                sx={{
                  width: dot === 0 ? 14 : 10,
                  height: 2,
                  bgcolor:
                    dot === 0
                      ? "rgba(255,255,255,0.82)"
                      : "rgba(255,255,255,0.28)",
                }}
              />
            ))}
          </Stack>
          <IconButton
            size="small"
            onClick={() => scrollRail(-1)}
            sx={{
              color: "common.white",
              bgcolor: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.12)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => scrollRail(1)}
            sx={{
              color: "common.white",
              bgcolor: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.12)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
      </Stack>
      <Box
        ref={railRef}
        sx={{
          display: "flex",
          gap: { xs: 1, md: 1.25 },
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x proximity",
          scrollBehavior: "smooth",
          pb: 1.25,
          mx: { xs: -2, md: -4, lg: -7.5 },
          px: { xs: 2, md: 4, lg: 7.5 },
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {items.map((item, index) => (
          <MediaCard
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            favorite={favoriteIds.includes(item.id)}
            compact={compact}
            rank={ranked ? index + 1 : undefined}
            progress={playbackProgress?.[item.id]}
            enablePreview={enablePreview}
            onPlay={() => onPlay(item)}
            onFavorite={() => onFavorite(item)}
          />
        ))}
      </Box>
    </Box>
  );
}

function MediaGrid({
  title,
  subtitle,
  items,
  favoriteIds,
  compact,
  selectedId,
  playbackProgress,
  enablePreview,
  onPlay,
  onFavorite,
}: {
  title: string;
  subtitle?: string;
  items: IptvChannel[];
  favoriteIds: string[];
  compact: boolean;
  selectedId?: string;
  playbackProgress?: PlaybackProgress;
  enablePreview: boolean;
  onPlay: (item: IptvChannel) => void;
  onFavorite: (item: IptvChannel) => void;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1.2} sx={{ mb: 1.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" sx={{ color: "grey.500" }}>
            {subtitle}
          </Typography>
        )}
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            sm: "repeat(3, minmax(0, 1fr))",
            md: "repeat(5, minmax(0, 1fr))",
            lg: "repeat(7, minmax(0, 1fr))",
          },
          gap: { xs: 1.1, md: 1.35 },
        }}
      >
        {items.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            favorite={favoriteIds.includes(item.id)}
            compact={compact}
            grid
            progress={playbackProgress?.[item.id]}
            enablePreview={enablePreview}
            onPlay={() => onPlay(item)}
            onFavorite={() => onFavorite(item)}
          />
        ))}
      </Box>
    </Box>
  );
}

function CategoryToolbar({
  categories,
  activeCategory,
  onSelect,
}: {
  categories: IptvCategory[];
  activeCategory: string;
  onSelect: (category: string) => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={0.8}
      sx={{
        overflowX: "auto",
        pb: 0.75,
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {categories.map((category) => {
        const selected = activeCategory === category.name;

        return (
          <Chip
            key={category.name}
            clickable
            onClick={() => onSelect(category.name)}
            label={
              category.name === "Todos"
                ? "Todos"
                : `${formatCategory(category.name)} (${category.count})`
            }
            sx={{
              flex: "0 0 auto",
              height: 34,
              borderRadius: 1,
              bgcolor: selected ? "common.white" : "rgba(255,255,255,0.1)",
              color: selected ? "#111" : "common.white",
              fontWeight: 900,
              "&:hover": {
                bgcolor: selected ? "#e8e8e8" : "rgba(255,255,255,0.18)",
              },
            }}
          />
        );
      })}
    </Stack>
  );
}

function CategoryRail({
  title,
  categories,
  items,
  activeCategory,
  onSelect,
}: {
  title: string;
  categories: IptvCategory[];
  items: IptvChannel[];
  activeCategory: string;
  onSelect: (category: string) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const visibleCategories = categories.filter((category) => category.name !== "Todos");

  if (!visibleCategories.length) {
    return null;
  }

  const scrollCategories = (direction: -1 | 1) => {
    railRef.current?.scrollBy({
      left: direction * Math.round((railRef.current?.clientWidth || 420) * 0.82),
      behavior: "smooth",
    });
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
        <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0 }}>
          {title}
        </Typography>
        <Stack direction="row" spacing={0.75}>
          <IconButton
            size="small"
            onClick={() => scrollCategories(-1)}
            sx={{
              color: "common.white",
              bgcolor: "rgba(255,255,255,0.1)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => scrollCategories(1)}
            sx={{
              color: "common.white",
              bgcolor: "rgba(255,255,255,0.1)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
      </Stack>
      <Box
        ref={railRef}
        sx={{
          display: "grid",
          gridAutoFlow: "column",
          gridAutoColumns: { xs: "150px", sm: "178px", md: "210px" },
          gap: 1.2,
          overflowX: "auto",
          pb: 1.25,
          mx: { xs: -2, md: -4, lg: -7.5 },
          px: { xs: 2, md: 4, lg: 7.5 },
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {visibleCategories.slice(0, 32).map((category) => {
          const selected = activeCategory === category.name;
          const sampleItem = items.find((item) => item.group === category.name && item.logo);
          const background = sampleItem?.logo
            ? `linear-gradient(135deg, rgba(0,0,0,0.82), rgba(0,0,0,0.38)), url("${sampleItem.logo}")`
            : "linear-gradient(135deg, #2a2a2a 0%, #141414 55%, #3b1115 100%)";

          return (
            <Box
              key={category.name}
              component="button"
              type="button"
              onClick={() => onSelect(category.name)}
              sx={{
                height: { xs: 96, md: 122 },
                p: 1.5,
                border: selected
                  ? "2px solid #e42c36"
                  : "1px solid rgba(255,255,255,0.1)",
                borderRadius: 1,
                bgcolor: "#191919",
                backgroundImage: background,
                backgroundSize: "cover",
                backgroundPosition: "center",
                color: "common.white",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                position: "relative",
                overflow: "hidden",
                transition:
                  "transform 160ms ease, border-color 160ms ease, background-color 160ms ease",
                "&:before": {
                  content: '""',
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(120deg, rgba(228,44,54,0.22), transparent 42%)",
                  opacity: selected ? 1 : 0.55,
                },
                "& > *": { position: "relative", zIndex: 1 },
                "&:hover": {
                  transform: { sm: "translateY(-3px)" },
                  borderColor: "rgba(255,255,255,0.42)",
                },
              }}
            >
              <Typography
                sx={{
                  fontWeight: 900,
                  lineHeight: 1.05,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {formatCategory(category.name)}
              </Typography>
              <Typography variant="caption" sx={{ color: "grey.400", fontWeight: 800 }}>
                {category.count} titulos
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function DetailDialog({
  open,
  item,
  relatedItems,
  episodeItems,
  favorite,
  liked,
  onClose,
  onPlay,
  onFavorite,
  onLike,
  onSelectRelated,
}: {
  open: boolean;
  item: IptvChannel | null;
  relatedItems: IptvChannel[];
  episodeItems: IptvChannel[];
  favorite: boolean;
  liked: boolean;
  onClose: () => void;
  onPlay: (item: IptvChannel) => void;
  onFavorite: (item: IptvChannel) => void;
  onLike: (item: IptvChannel) => void;
  onSelectRelated: (item: IptvChannel) => void;
}) {
  const artwork = getHeroArtwork(item);
  const seasons = useMemo(
    () => (item?.contentType === "series" ? buildEpisodeCatalog(item, episodeItems) : []),
    [episodeItems, item]
  );
  const [activeSeason, setActiveSeason] = useState(1);
  const [synopsis, setSynopsis] = useState("");

  useEffect(() => {
    setActiveSeason(seasons[0]?.season || 1);
  }, [item?.id, seasons]);

  useEffect(() => {
    if (!open || !item) {
      setSynopsis("");
      return;
    }

    let cancelled = false;
    const fallbackSynopsis = buildSmartSynopsis(item);
    setSynopsis(fallbackSynopsis);

    fetch("/api/epg/synopsis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item: {
          name: item.name,
          group: item.group,
          contentType: item.contentType,
          tvgId: item.tvgId,
          tvgName: item.tvgName,
        },
      }),
      })
      .then((response) => {
        return readJsonResponse<{ synopsis?: string }>(
          response,
          "Sinopse indisponivel"
        );
      })
      .then((data) => {
        if (!cancelled && data.synopsis) {
          setSynopsis(data.synopsis);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [item, open]);

  const currentSeason = seasons.find((season) => season.season === activeSeason);
  const isCatalogedSeries = item?.contentType === "series" && seasons.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          bgcolor: "#181818",
          color: "common.white",
          borderRadius: { xs: 0, sm: 2 },
          overflow: "hidden",
        },
      }}
    >
      {item && (
        <>
          <Box
            sx={{
              minHeight: { xs: 360, sm: 440 },
              position: "relative",
              p: { xs: 2, sm: 3 },
              display: "flex",
              alignItems: "flex-end",
              backgroundImage: artwork
                ? `linear-gradient(180deg, rgba(0,0,0,0.08), #181818 92%), linear-gradient(90deg, rgba(0,0,0,0.74), rgba(0,0,0,0.08)), ${artwork}`
                : "linear-gradient(135deg, #333, #111)",
              backgroundSize:
                item.contentType === "live"
                  ? "cover, cover, min(58%, 520px)"
                  : "cover, cover, cover",
              backgroundRepeat: "no-repeat",
              backgroundPosition:
                item.contentType === "live" ? "center, center, right center" : "center",
            }}
          >
            <IconButton
              onClick={onClose}
              sx={{
                position: "absolute",
                top: 16,
                right: 16,
                color: "common.white",
                bgcolor: "rgba(0,0,0,0.72)",
                "&:hover": { bgcolor: "rgba(0,0,0,0.9)" },
              }}
            >
              <CloseIcon />
            </IconButton>

            <Stack spacing={1.6} sx={{ width: "min(620px, 100%)" }}>
              <Typography
                variant="h2"
                sx={{
                  fontWeight: 900,
                  lineHeight: 0.95,
                  letterSpacing: 0,
                  textTransform: "uppercase",
                  fontSize: { xs: 38, sm: 58 },
                  textShadow: "0 6px 30px rgba(0,0,0,0.75)",
                }}
              >
                {item.name}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => onPlay(item)}
                  sx={{
                    bgcolor: "common.white",
                    color: "#111",
                    borderRadius: 1,
                    fontWeight: 900,
                    px: 3,
                    "&:hover": { bgcolor: "#ddd" },
                  }}
                >
                  Continuar
                </Button>
                <IconButton
                  onClick={() => onFavorite(item)}
                  sx={{
                    color: "common.white",
                    border: "2px solid rgba(255,255,255,0.72)",
                    bgcolor: "rgba(0,0,0,0.35)",
                  }}
                >
                  {favorite ? <BookmarkIcon /> : <AddIcon />}
                </IconButton>
                <IconButton
                  onClick={() => onLike(item)}
                  sx={{
                    color: liked ? "#111" : "common.white",
                    border: "2px solid rgba(255,255,255,0.72)",
                    bgcolor: liked ? "common.white" : "rgba(0,0,0,0.35)",
                  }}
                >
                  <ThumbUpOutlinedIcon />
                </IconButton>
              </Stack>
            </Stack>
          </Box>

          <DialogContent sx={{ p: { xs: 2, sm: 3 }, bgcolor: "#181818" }}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "1.35fr 0.85fr" },
                gap: 3,
              }}
            >
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography sx={{ color: "#46d369", fontWeight: 900 }}>
                    {favorite ? "99% relevante" : "Novo para voce"}
                  </Typography>
                  <Typography>{getTypeLabel(item.contentType)}</Typography>
                  {isCatalogedSeries && (
                    <Chip
                      size="small"
                      icon={<AutoAwesomeIcon />}
                      label="Serie organizada"
                      sx={{
                        height: 24,
                        bgcolor: "rgba(228,44,54,0.2)",
                        color: "common.white",
                        fontWeight: 900,
                      }}
                    />
                  )}
                  {hasBrowserRiskyCodec(item) && (
                    <Chip size="small" color="warning" label="H265/HEVC" />
                  )}
                </Stack>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>
                  {item.contentType === "live"
                    ? "Canal ao vivo pronto para assistir"
                    : "Assista agora ou salve na sua lista"}
                </Typography>
                <Typography sx={{ color: "grey.200", lineHeight: 1.55 }}>
                  {synopsis || buildSmartSynopsis(item)}
                </Typography>
              </Stack>

              <Stack spacing={1}>
                <Typography variant="body2" sx={{ color: "grey.500" }}>
                  Generos:{" "}
                  <Box component="span" sx={{ color: "grey.100", fontWeight: 800 }}>
                    {formatCategory(item.group || "Sem categoria")}
                  </Box>
                </Typography>
                <Typography variant="body2" sx={{ color: "grey.500" }}>
                  Tipo:{" "}
                  <Box component="span" sx={{ color: "grey.100", fontWeight: 800 }}>
                    {getTypeLabel(item.contentType)}
                  </Box>
                </Typography>
                <Typography variant="body2" sx={{ color: "grey.500" }}>
                  Catalogacao:{" "}
                  <Box component="span" sx={{ color: "grey.100", fontWeight: 800 }}>
                    {isCatalogedSeries
                      ? `${seasons.length} temporada(s), ${seasons.reduce(
                          (count, season) => count + season.episodes.length,
                          0
                        )} episodio(s)`
                      : "Item unico"}
                  </Box>
                </Typography>
              </Stack>
            </Box>

            {isCatalogedSeries && currentSeason && (
              <Box sx={{ mt: 4 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography variant="h5" sx={{ fontWeight: 900 }}>
                    Episodios
                  </Typography>
                  <Chip
                    size="small"
                    icon={<AutoAwesomeIcon />}
                    label="Catalogado"
                    sx={{
                      bgcolor: "rgba(255,255,255,0.1)",
                      color: "grey.100",
                      fontWeight: 800,
                    }}
                  />
                </Stack>

                <Stack
                  direction="row"
                  spacing={0.8}
                  sx={{
                    overflowX: "auto",
                    pb: 1,
                    scrollbarWidth: "none",
                    "&::-webkit-scrollbar": { display: "none" },
                  }}
                >
                  {seasons.map((season) => (
                    <Button
                      key={season.season}
                      onClick={() => setActiveSeason(season.season)}
                      sx={{
                        flex: "0 0 auto",
                        color:
                          activeSeason === season.season ? "#111" : "common.white",
                        bgcolor:
                          activeSeason === season.season
                            ? "common.white"
                            : "rgba(255,255,255,0.1)",
                        borderRadius: 1,
                        fontWeight: 900,
                        "&:hover": {
                          bgcolor:
                            activeSeason === season.season
                              ? "#e8e8e8"
                              : "rgba(255,255,255,0.18)",
                        },
                      }}
                    >
                      Temporada {season.season}
                    </Button>
                  ))}
                </Stack>

                <Stack spacing={1}>
                  {currentSeason.episodes.slice(0, 24).map((episode) => {
                    const episodeInfo = parseEpisodeInfo(episode);

                    return (
                      <Box
                        key={episode.id}
                        component="button"
                        type="button"
                        onClick={() => onPlay(episode)}
                        sx={{
                          width: "100%",
                          display: "grid",
                          gridTemplateColumns: {
                            xs: "84px minmax(0, 1fr) 44px",
                            sm: "132px minmax(0, 1fr) 54px",
                          },
                          gap: 1.5,
                          alignItems: "center",
                          p: 1,
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 1,
                          bgcolor: "rgba(255,255,255,0.045)",
                          color: "common.white",
                          textAlign: "left",
                          cursor: "pointer",
                          "&:hover": { bgcolor: "rgba(255,255,255,0.1)" },
                        }}
                      >
                        <Box
                          sx={{
                            aspectRatio: "16 / 9",
                            bgcolor: "#262626",
                            borderRadius: 0.75,
                            overflow: "hidden",
                          }}
                        >
                          <MediaThumb item={episode} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 900 }} noWrap>
                            {String(episodeInfo.episode).padStart(2, "0")}.{" "}
                            {episode.name}
                          </Typography>
                          <Typography variant="body2" sx={{ color: "grey.400" }} noWrap>
                            Agrupado automaticamente a partir da lista M3U
                          </Typography>
                        </Box>
                        <IconButton sx={{ color: "common.white" }}>
                          <PlayArrowIcon />
                        </IconButton>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            )}

            {relatedItems.length > 0 && (
              <Box sx={{ mt: 4 }}>
                <Typography variant="h5" sx={{ fontWeight: 900, mb: 1.5 }}>
                  Titulos semelhantes
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "repeat(2, minmax(0, 1fr))",
                      sm: "repeat(3, minmax(0, 1fr))",
                    },
                    gap: 1,
                  }}
                >
                  {relatedItems.slice(0, 6).map((relatedItem) => (
                    <Box
                      key={relatedItem.id}
                      component="button"
                      type="button"
                      onClick={() => onSelectRelated(relatedItem)}
                      sx={{
                        p: 0,
                        border: 0,
                        borderRadius: 1,
                        overflow: "hidden",
                        bgcolor: "#242424",
                        cursor: "pointer",
                        aspectRatio: relatedItem.contentType === "live" ? "16 / 9" : "2 / 3",
                      }}
                    >
                      <MediaThumb item={relatedItem} />
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}

export function Component() {
  const playerRef = useRef<Player | null>(null);
  const playerProgressCleanupRef = useRef<(() => void) | null>(null);
  const playbackProgressRef = useRef<PlaybackProgress>({});
  const playbackSaveRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [catalog, setCatalog] = useState<IptvCatalog | null>(null);
  const [selectedItem, setSelectedItem] = useState<IptvChannel | null>(null);
  const [activeSection, setActiveSection] = useState<SectionType>("live");
  const [activeCategory, setActiveCategory] = useState("Todos");
  const [query, setQuery] = useState("");
  const [sortFilter, setSortFilter] = useState<SortFilter>("smart");
  const [fullCatalogOpen, setFullCatalogOpen] = useState(false);
  const [items, setItems] = useState<IptvChannel[]>([]);
  const [smartItems, setSmartItems] = useState<IptvChannel[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [favoriteItems, setFavoriteItems] = useState<IptvChannel[]>(
    readStorage<IptvChannel[]>(STORAGE_KEYS.favorites, [])
  );
  const [likedItems, setLikedItems] = useState<IptvChannel[]>(
    readStorage<IptvChannel[]>(STORAGE_KEYS.liked, [])
  );
  const [recentItems, setRecentItems] = useState<IptvChannel[]>(
    readStorage<IptvChannel[]>(STORAGE_KEYS.recent, [])
  );
  const [watchCounts, setWatchCounts] = useState<Record<string, number>>(
    readStorage<Record<string, number>>(STORAGE_KEYS.watchCounts, {})
  );
  const [playbackProgress, setPlaybackProgress] = useState<PlaybackProgress>(
    readStorage<PlaybackProgress>(STORAGE_KEYS.progress, {})
  );
  const [settings, setSettings] = useState<PlaybackSettings>({
    ...DEFAULT_SETTINGS,
    ...readStorage<Partial<PlaybackSettings>>(STORAGE_KEYS.settings, {}),
  });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingSmartItems, setLoadingSmartItems] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [theaterOpen, setTheaterOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const favoriteIds = useMemo(
    () => favoriteItems.map((item) => item.id),
    [favoriteItems]
  );
  const likedIds = useMemo(
    () => likedItems.map((item) => item.id),
    [likedItems]
  );

  const categories = useMemo(() => {
    if (!catalog || activeSection === "favorites") {
      return [{ name: "Todos", count: favoriteItems.length }];
    }

    if (activeSection === "anime") {
      const animeCategories = (catalog.categories.series || []).filter((category) =>
        isAnimeItem({
          id: category.name,
          name: category.name,
          url: "",
          contentType: "series",
          group: category.name,
        })
      );

      return orderCategoriesForSection([
        { name: "Todos", count: animeCategories.reduce((sum, item) => sum + item.count, 0) },
        ...animeCategories,
      ], activeSection);
    }

    if (activeSection === "series") {
      const seriesCategories = (catalog.categories.series || []).filter(
        (category) =>
          !isAnimeItem({
            id: category.name,
            name: category.name,
            url: "",
            contentType: "series",
            group: category.name,
          })
      );

      return orderCategoriesForSection([
        { name: "Todos", count: seriesCategories.reduce((sum, item) => sum + item.count, 0) },
        ...seriesCategories,
      ], activeSection);
    }

    return orderCategoriesForSection([
      { name: "Todos", count: catalog.counts[activeSection] || 0 },
      ...(catalog.categories[getApiType(activeSection)] || []),
    ], activeSection);
  }, [activeSection, catalog, favoriteItems.length]);

  const filteredFavorites = useMemo(
    () => filterLocalItems(favoriteItems, query),
    [favoriteItems, query]
  );

  const tasteProfile = useMemo(
    () =>
      buildTasteProfile({
        favoriteItems,
        recentItems: uniqById([...likedItems, ...recentItems]),
        watchCounts,
      }),
    [favoriteItems, likedItems, recentItems, watchCounts]
  );

  const rawDisplayItems =
    activeSection === "favorites"
      ? filteredFavorites
      : catalogItemsForSection(items, activeSection);

  const displayItems = useMemo(() => {
    return sortItems({
      items: rawDisplayItems,
      sort: sortFilter,
      favoriteIds,
      profile: tasteProfile,
      watchCounts,
    });
  }, [
    favoriteIds,
    rawDisplayItems,
    sortFilter,
    tasteProfile,
    watchCounts,
  ]);

  const continueItems = useMemo(
    () => catalogItemsForSection(recentItems, activeSection).slice(0, 24),
    [activeSection, recentItems]
  );

  const popularItems = useMemo(() => {
    return catalogItemsForSection(
      uniqById([...recentItems, ...favoriteItems, ...likedItems, ...items, ...smartItems]),
      activeSection
    )
      .sort((a, b) => (watchCounts[b.id] || 0) - (watchCounts[a.id] || 0))
      .filter((item) => (watchCounts[item.id] || 0) > 0)
      .slice(0, 10);
  }, [activeSection, favoriteItems, items, likedItems, recentItems, smartItems, watchCounts]);

  const launchItems = useMemo(() => {
    if (activeSection === "live" || activeSection === "favorites") {
      return [];
    }

    const sourceItems = catalogItemsForSection(items, activeSection);
    const launchMatches = sourceItems.filter((item) => {
      const text = normalize(`${item.name} ${item.group || ""}`);
      return (
        text.includes("lanc") ||
        text.includes("nov") ||
        text.includes("estreia") ||
        text.includes("4k")
      );
    });

    return (launchMatches.length ? launchMatches : sourceItems).slice(0, 24);
  }, [activeSection, items]);

  const firstRailItems = useMemo(
    () => displayItems.slice(0, 24),
    [displayItems]
  );

  const topItems = useMemo(
    () => (popularItems.length ? popularItems : firstRailItems.slice(0, 10)),
    [firstRailItems, popularItems]
  );
  const isFocusedCatalog =
    fullCatalogOpen || activeCategory !== "Todos" || Boolean(query.trim());
  const recommendationTitle =
    activeSection === "live"
      ? "Canais recomendados"
      : `Recomendados em ${getSectionLabel(activeSection)}`;
  const recommendationSubtitle =
    activeSection === "live"
      ? "selecionados do catalogo ao vivo"
      : tasteProfile.hasTaste
        ? "com base no seu historico"
        : "primeiras sugestoes para comecar";

  const smartSuggestions = useMemo(() => {
    const candidates = catalogItemsForSection(
      uniqById([...favoriteItems, ...likedItems, ...recentItems, ...smartItems, ...items]),
      activeSection
    ).filter(
      (item) => settings.showRiskyCodecs || !hasBrowserRiskyCodec(item)
    );

    return sortItems({
      items: candidates,
      sort: "smart",
      favoriteIds,
      profile: tasteProfile,
      watchCounts,
    }).slice(0, 24);
  }, [
    activeSection,
    favoriteIds,
    favoriteItems,
    items,
    likedItems,
    recentItems,
    settings.showRiskyCodecs,
    smartItems,
    tasteProfile,
    watchCounts,
  ]);

  const smartHighlight = smartSuggestions[0] || null;
  const heroCandidates = useMemo(
    () => uniqById([...launchItems, ...smartSuggestions, ...firstRailItems]).slice(0, 8),
    [firstRailItems, launchItems, smartSuggestions]
  );
  const heroItem = useMemo(
    () =>
      heroCandidates[heroIndex % Math.max(heroCandidates.length, 1)] ||
      catalog?.featured ||
      null,
    [catalog?.featured, heroCandidates, heroIndex]
  );
  const selectedRelatedItems = useMemo(() => {
    if (!selectedItem) {
      return smartSuggestions.slice(0, 6);
    }

    const selectedGroup = normalize(selectedItem.group || "");
    const relatedSection: SectionType =
      selectedItem.contentType === "series"
        ? isAnimeItem(selectedItem)
          ? "anime"
          : "series"
        : selectedItem.contentType;

    return catalogItemsForSection(
      uniqById([...smartSuggestions, ...items, ...favoriteItems, ...likedItems]),
      relatedSection
    )
      .filter((item) => {
        return (
          item.id !== selectedItem.id &&
          item.contentType === selectedItem.contentType &&
          normalize(item.group || "") === selectedGroup
        );
      })
      .slice(0, 6);
  }, [favoriteItems, items, likedItems, selectedItem, smartSuggestions]);
  const episodePool = useMemo(
    () =>
      uniqById([
        ...items,
        ...smartItems,
        ...recentItems,
        ...favoriteItems,
        ...likedItems,
      ]),
    [favoriteItems, items, likedItems, recentItems, smartItems]
  );

  const loadCatalog = async () => {
    setLoadingCatalog(true);
    setError(null);

    try {
      const response = await fetch(`/api/iptv/catalog?t=${Date.now()}`, {
        cache: "no-store",
      });

      const data = await readJsonResponse<IptvCatalog>(
        response,
        "Catalogo indisponivel"
      );
      setCatalog(data);
      setSelectedItem((current) => current || data.featured);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar sua lista."
      );
    } finally {
      setLoadingCatalog(false);
    }
  };

  const loadPage = async (nextPage: number, replace: boolean) => {
    if (activeSection === "favorites") {
      return;
    }

    setLoadingItems(true);

    try {
      const apiType = getApiType(activeSection);
      const params = new URLSearchParams({
        type: apiType,
        category: activeCategory,
        q: query,
        page: String(nextPage),
        pageSize: activeSection === "series" || activeSection === "anime" ? "96" : "72",
        includeRiskyCodecs: settings.showRiskyCodecs ? "1" : "0",
      });

      if (activeSection === "anime") {
        params.set("animeOnly", "1");
      }

      if (activeSection === "series") {
        params.set("excludeAnime", "1");
      }
      const response = await fetch(`/api/iptv/items?${params.toString()}`);

      const data = await readJsonResponse<{
        items: IptvChannel[];
        total: number;
        page: number;
        hasMore: boolean;
      }>(response, "Itens indisponiveis");
      const safeItems = asItemList(data.items).filter((item) =>
        matchesSection(item, activeSection)
      );
      const catalogedPageItems = catalogItemsForSection(safeItems, activeSection);

      setItems((current) => (replace ? safeItems : [...current, ...safeItems]));
      setTotal(Number(data.total || safeItems.length));
      setPage(Number(data.page || nextPage));
      setHasMore(Boolean(data.hasMore));

      if (replace && catalogedPageItems[0]) {
        setSelectedItem(
          catalogedPageItems.find((item) => !hasBrowserRiskyCodec(item)) ||
            catalogedPageItems[0]
        );
      }
    } catch (loadError) {
      if (replace) {
        setItems([]);
        setTotal(0);
        setPage(1);
        setHasMore(false);
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar os itens desta categoria."
      );
    } finally {
      setLoadingItems(false);
    }
  };

  const loadSmartItems = async () => {
    setLoadingSmartItems(true);

    try {
      const baseParams = {
        category: "Todos",
        page: "1",
        pageSize: "72",
        includeRiskyCodecs: settings.showRiskyCodecs ? "1" : "0",
      };
      const [moviesResponse, seriesResponse] = await Promise.all([
        fetch(
          `/api/iptv/items?${new URLSearchParams({
            ...baseParams,
            type: "movie",
          }).toString()}`
        ),
        fetch(
          `/api/iptv/items?${new URLSearchParams({
            ...baseParams,
            type: "series",
          }).toString()}`
        ),
      ]);

      const [moviesData, seriesData] = await Promise.all([
        readJsonResponse<{ items: IptvChannel[] }>(
          moviesResponse,
          "Sugestoes de filmes indisponiveis"
        ),
        readJsonResponse<{ items: IptvChannel[] }>(
          seriesResponse,
          "Sugestoes de series indisponiveis"
        ),
      ]);

      setSmartItems(
        uniqById([...asItemList(moviesData.items), ...asItemList(seriesData.items)])
      );
    } catch {
      setSmartItems([]);
    } finally {
      setLoadingSmartItems(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    const syncSectionFromHash = () => {
      const nextSection = getSectionFromHash(window.location.hash);
      setActiveSection((current) => {
        if (current === nextSection) {
          return current;
        }

        setActiveCategory("Todos");
        setQuery("");
        setFullCatalogOpen(false);
        return nextSection;
      });
    };

    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    return () => window.removeEventListener("hashchange", syncSectionFromHash);
  }, []);

  useEffect(() => {
    if (!catalog) {
      return;
    }

    loadSmartItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, settings.showRiskyCodecs]);

  useEffect(() => {
    setHeroIndex(0);
  }, [activeSection, activeCategory, query]);

  useEffect(() => {
    if (detailOpen || theaterOpen || heroCandidates.length < 2) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setHeroIndex((current) => current + 1);
    }, 12000);

    return () => window.clearInterval(timer);
  }, [detailOpen, heroCandidates.length, theaterOpen]);

  useEffect(() => writeStorage(STORAGE_KEYS.favorites, favoriteItems), [
    favoriteItems,
  ]);
  useEffect(() => writeStorage(STORAGE_KEYS.liked, likedItems), [likedItems]);
  useEffect(() => writeStorage(STORAGE_KEYS.recent, recentItems), [recentItems]);
  useEffect(() => writeStorage(STORAGE_KEYS.watchCounts, watchCounts), [
    watchCounts,
  ]);
  useEffect(() => {
    playbackProgressRef.current = playbackProgress;
    writeStorage(STORAGE_KEYS.progress, playbackProgress);
  }, [playbackProgress]);
  useEffect(() => writeStorage(STORAGE_KEYS.settings, settings), [settings]);

  useEffect(
    () => () => {
      playerProgressCleanupRef.current?.();
    },
    []
  );

  useEffect(() => {
    if (activeSection === "favorites") {
      setTotal(filteredFavorites.length);
      return;
    }

    const timer = window.setTimeout(() => {
      loadPage(1, true);
    }, 250);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, activeCategory, query, settings.showRiskyCodecs]);

  useEffect(() => {
    if (!pendingPlay || !playerRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      playerRef.current?.muted(settings.mutedStart);
      playerRef.current?.volume(settings.volume);
      playerRef.current?.play()?.catch(() => undefined);
      setPendingPlay(false);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [pendingPlay, selectedItem, settings.mutedStart, settings.volume]);

  const videoJsOptions = useMemo(
    () => ({
      autoplay: true,
      controls: true,
      fill: true,
      fluid: false,
      muted: settings.mutedStart,
      volume: settings.volume,
      playbackRates: [0.75, 1, 1.25, 1.5, 2],
      preload: "auto",
      responsive: true,
      sources: selectedItem
        ? [
            {
              src: `/api/iptv/stream?id=${encodeURIComponent(
                selectedItem.id
              )}`,
              type: getVideoType(selectedItem.url),
            },
          ]
        : [],
    }),
    [selectedItem, settings.mutedStart, settings.volume]
  );

  const rememberPlayback = (item: IptvChannel) => {
    setRecentItems((current) => uniqById([item, ...current]).slice(0, 40));
    setWatchCounts((current) => ({
      ...current,
      [item.id]: (current[item.id] || 0) + 1,
    }));
  };

  const openPlayer = (item?: IptvChannel | null) => {
    if (!item) {
      return;
    }

    setSelectedItem(item);
    rememberPlayback(item);

    if (hasBrowserRiskyCodec(item) && !settings.showRiskyCodecs) {
      setTheaterOpen(false);
      setPendingPlay(false);
      setError(
        "Este item e H265/HEVC e pode tocar apenas audio no navegador. Ative H265 nas configuracoes ou escolha uma versao HD/FHD."
      );
      return;
    }

    setError(null);
    setDetailOpen(false);
    setTheaterOpen(true);
    setPendingPlay(true);
  };

  const handlePlayItem = (item: IptvChannel) => {
    setSelectedItem(item);

    if (item.contentType !== "live") {
      setDetailOpen(true);
      return;
    }

    if (settings.playOnCardClick) {
      openPlayer(item);
      return;
    }

    if (window.innerWidth < 900) {
      contentRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleFavoriteToggle = (item: IptvChannel) => {
    setFavoriteItems((current) => {
      const exists = current.some((currentItem) => currentItem.id === item.id);
      return exists
        ? current.filter((currentItem) => currentItem.id !== item.id)
        : [item, ...current];
    });
  };

  const handleLikeToggle = (item: IptvChannel) => {
    setLikedItems((current) => {
      const exists = current.some((currentItem) => currentItem.id === item.id);
      return exists
        ? current.filter((currentItem) => currentItem.id !== item.id)
        : [item, ...current];
    });
  };

  const handleSectionChange = (section: SectionType) => {
    if (section !== "favorites") {
      window.location.hash = getSectionHash(section);
    }

    setActiveSection(section);
    setActiveCategory("Todos");
    setQuery("");
    setFullCatalogOpen(false);

    if (section === "favorites") {
      setSelectedItem(favoriteItems[0] || recentItems[0] || selectedItem);
    }
  };

  const handlePlayerReady = (player: Player) => {
    playerProgressCleanupRef.current?.();
    playerRef.current = player;
    player.volume(settings.volume);
    player.muted(settings.mutedStart);

    const item = selectedItem;

    if (!item) {
      return;
    }

    const saveProgress = () => {
      const now = Date.now();

      if (now - playbackSaveRef.current < 4500) {
        return;
      }

      playbackSaveRef.current = now;
      const time = Number(player.currentTime() || 0);
      const duration = Number(player.duration() || 0);

      if (!Number.isFinite(time) || time < 1) {
        return;
      }

      setPlaybackProgress((current) => ({
        ...current,
        [item.id]: {
          time,
          duration: Number.isFinite(duration) ? duration : 0,
          updatedAt: new Date().toISOString(),
        },
      }));
    };

    const restoreProgress = () => {
      const saved = playbackProgressRef.current[item.id];

      if (
        saved?.time &&
        saved.time > 8 &&
        (!saved.duration || saved.time < saved.duration - 14)
      ) {
        player.currentTime(saved.time);
      }
    };

    const restoreTimer = window.setTimeout(restoreProgress, 650);
    player.on("loadedmetadata", restoreProgress);
    player.on("timeupdate", saveProgress);
    player.on("pause", saveProgress);
    player.on("ended", saveProgress);

    playerProgressCleanupRef.current = () => {
      window.clearTimeout(restoreTimer);
      saveProgress();
      player.off("loadedmetadata", restoreProgress);
      player.off("timeupdate", saveProgress);
      player.off("pause", saveProgress);
      player.off("ended", saveProgress);
    };
  };

  const heroImage = getHeroArtwork(heroItem);
  const selectedIsFavorite = Boolean(
    heroItem && favoriteIds.includes(heroItem.id)
  );

  return (
    <Box
      sx={{
        minHeight: "100vh",
        pb: { xs: 10, md: 6 },
        bgcolor: "#111",
        color: "common.white",
        overflowX: "hidden",
      }}
    >
      <Box
        ref={contentRef}
        sx={{
          position: "relative",
          minHeight: { xs: "68vh", md: "78vh" },
          mx: { xs: 0, md: 5, lg: 6 },
          mt: { xs: 0, md: 2.5 },
          px: { xs: 2, md: 5, lg: 5 },
          pt: { xs: "96px", md: "104px" },
          pb: { xs: 8, md: 7 },
          display: "flex",
          alignItems: "flex-end",
          borderRadius: { xs: 0, md: 3 },
          overflow: "hidden",
          boxShadow: { xs: "none", md: "0 28px 60px rgba(0,0,0,0.58)" },
          backgroundImage: heroImage
            ? `linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.56) 35%, rgba(0,0,0,0.08) 72%), linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.22) 48%, #111 100%), ${heroImage}`
            : "linear-gradient(135deg, #242424 0%, #111 55%, #060606 100%)",
          backgroundRepeat: "no-repeat",
          backgroundSize:
            heroItem?.contentType === "live"
              ? "auto, auto, min(52vw, 720px)"
              : "cover, cover, cover",
          backgroundPosition:
            heroItem?.contentType === "live"
              ? "center, center, right 8% center"
              : "center",
          "&:after": {
            content: '""',
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -1,
            height: 150,
            background: "linear-gradient(180deg, transparent, #111)",
          },
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "flex-start", sm: "center" }}
          sx={{
            position: "absolute",
            top: { xs: 88, md: 104 },
            left: { xs: 16, md: 40 },
            right: { xs: 16, md: 40 },
            zIndex: 2,
          }}
        >
          <Typography
            variant="h4"
            sx={{
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: 0,
              textShadow: "0 4px 22px rgba(0,0,0,0.65)",
            }}
          >
            {SECTIONS.find((section) => section.value === activeSection)?.label ||
              "Catalogo"}
          </Typography>

          <Select
            value={activeCategory}
            size="small"
            onChange={(event) => setActiveCategory(event.target.value)}
            IconComponent={ArrowDropDownIcon}
            sx={{
              minWidth: { xs: 154, sm: 178 },
              bgcolor: "rgba(0,0,0,0.74)",
              color: "common.white",
              borderRadius: 0,
              fontWeight: 900,
              ".MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(255,255,255,0.78)",
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: "common.white",
              },
              ".MuiSelect-icon": { color: "common.white" },
            }}
          >
            <MenuItem value="Todos">Generos</MenuItem>
            {categories
              .filter((category) => category.name !== "Todos")
              .map((category) => (
                <MenuItem key={category.name} value={category.name}>
                  {formatCategory(category.name)} ({category.count})
                </MenuItem>
              ))}
          </Select>

          <Select
            value={sortFilter}
            size="small"
            onChange={(event) => setSortFilter(event.target.value as SortFilter)}
            sx={{
              minWidth: { xs: 154, sm: 156 },
              bgcolor: "rgba(0,0,0,0.74)",
              color: "common.white",
              borderRadius: 0,
              ".MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(255,255,255,0.38)",
              },
              ".MuiSelect-icon": { color: "common.white" },
            }}
          >
            {SORT_FILTERS.map((sort) => (
              <MenuItem key={sort.value} value={sort.value}>
                {sort.label}
              </MenuItem>
            ))}
          </Select>

          {activeSection !== "live" && (
            <Chip
              size="small"
              icon={<AutoAwesomeIcon />}
              label={tasteProfile.hasTaste ? "Sugestoes ajustadas" : "Sugestoes prontas"}
              sx={{
                bgcolor: "rgba(255,255,255,0.14)",
                color: "common.white",
                fontWeight: 800,
              }}
            />
          )}
        </Stack>

        <Stack spacing={2.2} sx={{ width: "min(720px, 100%)", zIndex: 1 }}>
          {error && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={loadCatalog}>
                  Recarregar
                </Button>
              }
            >
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip
              size="small"
              label={getTypeLabel(heroItem?.contentType)}
              sx={{
                bgcolor: "#e42c36",
                color: "common.white",
                fontWeight: 900,
              }}
            />
            <Typography variant="body2" sx={{ color: "grey.300", fontWeight: 800 }}>
              {formatCategory(heroItem?.group || "Selecione um item")}
            </Typography>
            {hasBrowserRiskyCodec(heroItem) && (
              <Chip size="small" color="warning" label="H265/HEVC" />
            )}
          </Stack>

          <Typography
            variant="h1"
            sx={{
              fontWeight: 900,
              lineHeight: 0.92,
              letterSpacing: 0,
              textTransform: "uppercase",
              fontSize: { xs: 42, sm: 64, md: 86 },
              textShadow: "0 5px 30px rgba(0,0,0,0.65)",
            }}
          >
            {heroItem?.name || "Flux Play"}
          </Typography>

          <Typography
            variant="h6"
            sx={{
              maxWidth: 620,
              color: "grey.100",
              lineHeight: 1.35,
              fontSize: { xs: 16, md: 20 },
            }}
          >
            {heroItem?.contentType === "live"
              ? "Canal ao vivo pronto para assistir em modo cinema, com categorias e favoritos organizados."
              : "Destaque dinamico escolhido entre lancamentos, popularidade e recomendacoes."}
          </Typography>

          <Stack direction="row" spacing={1.2} flexWrap="wrap">
            <Button
              variant="contained"
              size="large"
              startIcon={<PlayArrowIcon />}
              onClick={() => {
                if (!heroItem) {
                  return;
                }

                setSelectedItem(heroItem);

                if (heroItem.contentType === "series") {
                  setDetailOpen(true);
                  return;
                }

                openPlayer(heroItem);
              }}
              disabled={!heroItem}
              sx={{
                bgcolor: "common.white",
                color: "#111",
                borderRadius: 1,
                px: { xs: 2.4, md: 3.4 },
                fontWeight: 900,
                "&:hover": { bgcolor: "#d8d8d8" },
              }}
            >
              Assistir
            </Button>
            {heroItem && (
              <Button
                size="large"
                startIcon={<InfoOutlinedIcon />}
                onClick={() => {
                  setSelectedItem(heroItem);
                  setDetailOpen(true);
                }}
                sx={{
                  bgcolor: "rgba(109,109,110,0.72)",
                  color: "common.white",
                  borderRadius: 1,
                  px: { xs: 2, md: 3 },
                  fontWeight: 900,
                  "&:hover": { bgcolor: "rgba(109,109,110,0.48)" },
                }}
              >
                Mais informacoes
              </Button>
            )}
            {heroItem && (
              <Tooltip title={selectedIsFavorite ? "Remover da lista" : "Adicionar a lista"}>
                <IconButton
                  onClick={() => handleFavoriteToggle(heroItem)}
                  sx={{
                    width: 48,
                    height: 48,
                    bgcolor: "rgba(109,109,110,0.72)",
                    color: "common.white",
                    borderRadius: "50%",
                    "&:hover": { bgcolor: "rgba(109,109,110,0.48)" },
                  }}
                >
                  {selectedIsFavorite ? <BookmarkIcon /> : <AddIcon />}
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Tela cheia">
              <IconButton
                onClick={() => {
                  if (!heroItem) {
                    return;
                  }

                  setSelectedItem(heroItem);

                  if (heroItem.contentType === "series") {
                    setDetailOpen(true);
                    return;
                  }

                  openPlayer(heroItem);
                }}
                sx={{
                  width: 48,
                  height: 48,
                  bgcolor: "rgba(109,109,110,0.72)",
                  color: "common.white",
                  borderRadius: 1,
                  "&:hover": { bgcolor: "rgba(109,109,110,0.48)" },
                }}
              >
                <FullscreenIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Configuracoes">
              <IconButton
                onClick={() => setSettingsOpen(true)}
                sx={{
                  width: 48,
                  height: 48,
                  bgcolor: "rgba(109,109,110,0.72)",
                  color: "common.white",
                  borderRadius: 1,
                  "&:hover": { bgcolor: "rgba(109,109,110,0.48)" },
                }}
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          </Stack>

          {hasBrowserRiskyCodec(heroItem) && (
            <Alert severity="warning" sx={{ width: "fit-content" }}>
              Este item parece ser H265/HEVC. No navegador pode sair audio sem
              imagem; prefira uma versao HD/FHD sem H265 quando existir.
            </Alert>
          )}
        </Stack>
      </Box>

      <Stack
        spacing={3.5}
        sx={{
          mt: { xs: -5, md: -8 },
          px: { xs: 2, md: 4, lg: 7.5 },
          position: "relative",
          zIndex: 2,
        }}
      >
        <Box
          sx={{
            p: 0,
            bgcolor: "transparent",
            border: 0,
          }}
        >
          <Stack spacing={1.25}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "flex-start", sm: "center" }}
              spacing={1.4}
              sx={{ display: "none" }}
            >
              <Typography
                variant="h4"
                sx={{ fontWeight: 900, lineHeight: 1, letterSpacing: 0 }}
              >
                {activeSection === "favorites"
                  ? "Minha lista"
                  : activeSection === "anime"
                    ? "Animes"
                  : activeSection === "movie"
                    ? "Filmes"
                    : activeSection === "series"
                      ? "Series"
                      : "Canais"}
              </Typography>

              <Select
                value={activeCategory}
                size="small"
                onChange={(event) => setActiveCategory(event.target.value)}
                IconComponent={ArrowDropDownIcon}
                sx={{
                  minWidth: 140,
                  bgcolor: "#050505",
                  color: "common.white",
                  borderRadius: 0,
                  fontWeight: 900,
                  ".MuiOutlinedInput-notchedOutline": {
                    borderColor: "rgba(255,255,255,0.78)",
                  },
                  "&:hover .MuiOutlinedInput-notchedOutline": {
                    borderColor: "common.white",
                  },
                  ".MuiSelect-icon": { color: "common.white" },
                }}
              >
                <MenuItem value="Todos">Generos</MenuItem>
                {categories
                  .filter((category) => category.name !== "Todos")
                  .map((category) => (
                    <MenuItem key={category.name} value={category.name}>
                      {formatCategory(category.name)} ({category.count})
                    </MenuItem>
                  ))}
              </Select>

              <Chip
                size="small"
                icon={<AutoAwesomeIcon />}
                label={tasteProfile.hasTaste ? "Sugestoes ajustadas" : "Sugestoes prontas"}
                sx={{
                  ml: { sm: "auto" },
                  bgcolor: "rgba(228,44,54,0.18)",
                  color: "common.white",
                  fontWeight: 800,
                }}
              />
            </Stack>

            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", lg: "center" }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  display: { xs: "none", lg: "none" },
                  overflowX: "auto",
                  pb: 0.3,
                  scrollbarWidth: "none",
                  "&::-webkit-scrollbar": { display: "none" },
                }}
              >
                {SECTIONS.map((section) => {
                  const selected = activeSection === section.value;
                  const count =
                    section.value === "favorites"
                      ? favoriteItems.length
                      : section.value === "anime"
                        ? categories[0]?.count || 0
                        : catalog?.counts[getApiType(section.value)] || 0;

                  return (
                    <Button
                      key={section.value}
                      onClick={() => handleSectionChange(section.value)}
                      sx={{
                        flex: "0 0 auto",
                        color: selected ? "#111" : "grey.200",
                        bgcolor: selected
                          ? "common.white"
                          : "rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        px: 2,
                        fontWeight: 900,
                        "&:hover": {
                          bgcolor: selected
                            ? "#e8e8e8"
                            : "rgba(255,255,255,0.18)",
                        },
                      }}
                    >
                      {section.label}
                      {count ? ` (${count})` : ""}
                    </Button>
                  );
                })}
              </Stack>

              <Box sx={{ flex: 1 }} />

              <TextField
                id="catalog-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar titulo, canal ou categoria"
                size="small"
                sx={{
                  width: { xs: "100%", lg: 340 },
                  bgcolor: "rgba(0,0,0,0.56)",
                  borderRadius: 1,
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
            </Stack>

            <Tooltip title="Atualizar catalogo">
              <IconButton
                color="inherit"
                onClick={loadCatalog}
                disabled={loadingCatalog}
                sx={{
                  alignSelf: "flex-end",
                  border: "1px solid rgba(255,255,255,0.26)",
                  borderRadius: 1,
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        {!isFocusedCatalog && activeSection !== "live" && smartHighlight && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "180px minmax(0, 1fr)" },
              gap: 2,
              p: { xs: 1.25, md: 1.5 },
              background:
                "linear-gradient(135deg, rgba(228,44,54,0.22), rgba(255,255,255,0.06))",
              border: "1px solid rgba(228,44,54,0.28)",
              borderRadius: 1,
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                minHeight: { xs: 126, md: 100 },
                aspectRatio: { xs: "16 / 9", md: "16 / 10" },
                bgcolor: "#181818",
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <MediaThumb item={smartHighlight} />
            </Box>
            <Stack spacing={1} justifyContent="center" sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip
                  size="small"
                  icon={<AutoAwesomeIcon />}
                  label={loadingSmartItems ? "Analisando catalogo" : "Destaque recomendado"}
                  sx={{
                    bgcolor: "#e42c36",
                    color: "common.white",
                    fontWeight: 900,
                  }}
                />
                <Typography variant="caption" sx={{ color: "grey.300" }}>
                  {tasteProfile.hasTaste
                    ? "baseado no seu historico e favoritos"
                    : "primeiras sugestoes para comecar"}
                </Typography>
              </Stack>
              <Typography variant="h5" noWrap sx={{ fontWeight: 900 }}>
                {smartHighlight.name}
              </Typography>
              <Typography variant="body2" sx={{ color: "grey.300" }} noWrap>
                {getTypeLabel(smartHighlight.contentType)} -{" "}
                {formatCategory(smartHighlight.group || "Sem categoria")}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => handlePlayItem(smartHighlight)}
                  sx={{
                    bgcolor: "common.white",
                    color: "#111",
                    borderRadius: 1,
                    fontWeight: 900,
                    "&:hover": { bgcolor: "#d8d8d8" },
                  }}
                >
                  Ver detalhes
                </Button>
                <Button
                  startIcon={<AddIcon />}
                  onClick={() => handleFavoriteToggle(smartHighlight)}
                  sx={{
                    color: "common.white",
                    bgcolor: "rgba(255,255,255,0.12)",
                    borderRadius: 1,
                    fontWeight: 900,
                    "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
                  }}
                >
                  Salvar
                </Button>
              </Stack>
            </Stack>
          </Box>
        )}

        {(loadingItems || loadingCatalog) && !displayItems.length && (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
            <CircularProgress color="inherit" />
            <Typography variant="body2" color="grey.500">
              Preparando catalogo...
            </Typography>
          </Stack>
        )}

        {!isFocusedCatalog && (
          <>
            <MediaRail
              title={recommendationTitle}
              subtitle={recommendationSubtitle}
              items={smartSuggestions}
              favoriteIds={favoriteIds}
              compact={settings.compactCards}
              selectedId={selectedItem?.id}
              playbackProgress={playbackProgress}
              enablePreview={settings.previewOnHover}
              onPlay={handlePlayItem}
              onFavorite={handleFavoriteToggle}
            />

            {activeSection !== "live" && (
              <MediaRail
                title={`Continuar em ${getSectionLabel(activeSection)}`}
                subtitle={`${continueItems.length} recentes`}
                items={continueItems}
                favoriteIds={favoriteIds}
                compact={settings.compactCards}
                selectedId={selectedItem?.id}
                playbackProgress={playbackProgress}
                enablePreview={settings.previewOnHover}
                onPlay={handlePlayItem}
                onFavorite={handleFavoriteToggle}
              />
            )}

            <MediaRail
              title={`Top 10 em ${getSectionLabel(activeSection)}`}
              subtitle={
                popularItems.length
                  ? "baseado no que voce abriu"
                  : "mais acessiveis agora"
              }
              items={topItems}
              favoriteIds={favoriteIds}
              compact={settings.compactCards}
              selectedId={selectedItem?.id}
              playbackProgress={playbackProgress}
              enablePreview={settings.previewOnHover}
              ranked
              onPlay={handlePlayItem}
              onFavorite={handleFavoriteToggle}
            />
          </>
        )}

        {isFocusedCatalog ? (
          <Stack spacing={1.5}>
            <CategoryToolbar
              categories={categories}
              activeCategory={activeCategory}
              onSelect={setActiveCategory}
            />
            <MediaGrid
              title={
                query.trim()
                  ? `Resultados para "${query.trim()}"`
                  : activeCategory === "Todos"
                    ? `Todos em ${getSectionLabel(activeSection)}`
                    : formatCategory(activeCategory)
              }
              subtitle={
                loadingItems || loadingCatalog
                  ? "carregando"
                  : activeSection === "series" || activeSection === "anime"
                    ? `${displayItems.length} titulos catalogados`
                    : `${displayItems.length} de ${total} item(s)`
              }
              items={displayItems}
              favoriteIds={favoriteIds}
              compact={settings.compactCards}
              selectedId={selectedItem?.id}
              playbackProgress={playbackProgress}
              enablePreview={settings.previewOnHover}
              onPlay={handlePlayItem}
              onFavorite={handleFavoriteToggle}
            />
          </Stack>
        ) : (
          <Stack spacing={1.2} alignItems="flex-start">
            <MediaRail
              title={
                activeSection === "favorites"
                  ? "Minha lista"
                  : activeCategory === "Todos"
                    ? getSectionLabel(activeSection)
                    : formatCategory(activeCategory)
              }
              subtitle={
                loadingItems || loadingCatalog
                  ? "carregando"
                  : activeSection === "series" || activeSection === "anime"
                    ? `${displayItems.length} titulos catalogados`
                    : `${displayItems.length} de ${total} item(s)`
              }
              items={firstRailItems}
              favoriteIds={favoriteIds}
              compact={settings.compactCards}
              selectedId={selectedItem?.id}
              playbackProgress={playbackProgress}
              enablePreview={settings.previewOnHover}
              onPlay={handlePlayItem}
              onFavorite={handleFavoriteToggle}
            />
            <Button
              variant="outlined"
              onClick={() => {
                setFullCatalogOpen(true);
                setTimeout(() => contentRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
              }}
              sx={{
                color: "common.white",
                borderColor: "rgba(255,255,255,0.42)",
                fontWeight: 900,
                borderRadius: 1,
                px: 3,
                "&:hover": {
                  borderColor: "#e42c36",
                  bgcolor: "rgba(228,44,54,0.16)",
                },
              }}
            >
              Ver mais
            </Button>
          </Stack>
        )}

        {!isFocusedCatalog && (
          <>
            <MediaRail
              title="Lancamentos e novidades"
              items={launchItems}
              favoriteIds={favoriteIds}
              compact={settings.compactCards}
              selectedId={selectedItem?.id}
              playbackProgress={playbackProgress}
              enablePreview={settings.previewOnHover}
              onPlay={handlePlayItem}
              onFavorite={handleFavoriteToggle}
            />

            <CategoryRail
              title={`Escolha por categoria em ${getSectionLabel(activeSection)}`}
              categories={categories}
              items={items}
              activeCategory={activeCategory}
              onSelect={setActiveCategory}
            />
          </>
        )}

        {!loadingItems && !displayItems.length && (
          <Stack alignItems="center" spacing={1} sx={{ py: 6 }}>
            <InfoOutlinedIcon />
            <Typography color="grey.500" textAlign="center">
              Nenhum item encontrado nesta categoria.
            </Typography>
          </Stack>
        )}

        {isFocusedCatalog && activeSection !== "favorites" && hasMore && (
          <Button
            variant="outlined"
            onClick={() => loadPage(page + 1, false)}
            disabled={loadingItems}
            sx={{
              alignSelf: "center",
              color: "common.white",
              borderColor: "rgba(255,255,255,0.42)",
              fontWeight: 900,
              borderRadius: 1,
              px: 3,
              "&:hover": {
                borderColor: "#e42c36",
                bgcolor: "rgba(228,44,54,0.16)",
              },
            }}
          >
            {loadingItems ? "Carregando..." : "Carregar mais"}
          </Button>
        )}
      </Stack>

      <Stack
        direction="row"
        sx={{
          display: { xs: "flex", md: "none" },
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 20,
          bgcolor: "rgba(0,0,0,0.96)",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(14px)",
        }}
      >
        {SECTIONS.map((section) => {
          const selected = activeSection === section.value;

          return (
            <Button
              key={section.value}
              onClick={() => handleSectionChange(section.value)}
              sx={{
                flex: 1,
                py: 1.2,
                minWidth: 0,
                borderRadius: 0,
                color: selected ? "common.white" : "grey.500",
                display: "flex",
                flexDirection: "column",
                gap: 0.25,
                fontSize: 11,
              }}
            >
              {section.value === "favorites" ? (
                <BookmarkIcon fontSize="small" />
              ) : section.value === "anime" ? (
                <TvIcon fontSize="small" />
              ) : (
                getTypeIcon(section.value)
              )}
              {section.label.replace("Minha lista", "Lista")}
            </Button>
          );
        })}
      </Stack>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={setSettings}
      />

      <DetailDialog
        open={detailOpen}
        item={selectedItem}
        relatedItems={selectedRelatedItems}
        episodeItems={episodePool}
        favorite={Boolean(selectedItem && favoriteIds.includes(selectedItem.id))}
        liked={Boolean(selectedItem && likedIds.includes(selectedItem.id))}
        onClose={() => setDetailOpen(false)}
        onPlay={openPlayer}
        onFavorite={handleFavoriteToggle}
        onLike={handleLikeToggle}
        onSelectRelated={(item) => {
          setSelectedItem(item);
          setDetailOpen(true);
        }}
      />

      <Dialog
        fullScreen
        open={theaterOpen}
        onClose={() => setTheaterOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: "black",
            backgroundImage: "none",
          },
        }}
      >
        <Box
          sx={{
            height: "100vh",
            minHeight: "100dvh",
            width: "100vw",
            position: "relative",
            bgcolor: "black",
            ".video-js": { width: "100%", height: "100%" },
            ".vjs-tech": {
              width: "100%",
              height: "100%",
              objectFit: "contain",
            },
          }}
        >
          {selectedItem && (
            <VideoJSPlayer
              key={`theater-${selectedItem.id}`}
              options={videoJsOptions}
              onReady={handlePlayerReady}
            />
          )}
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
              position: "absolute",
              top: 14,
              left: 14,
              right: 14,
              zIndex: 2,
              pointerEvents: "none",
            }}
          >
            <IconButton
              onClick={() => setTheaterOpen(false)}
              sx={{
                color: "common.white",
                bgcolor: "rgba(0,0,0,0.58)",
                pointerEvents: "auto",
                "&:hover": { bgcolor: "rgba(0,0,0,0.76)" },
              }}
            >
              <CloseIcon />
            </IconButton>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 900 }}>
                {selectedItem?.name}
              </Typography>
              <Typography variant="caption" noWrap sx={{ color: "grey.400" }}>
                {formatCategory(selectedItem?.group || "")}
              </Typography>
            </Box>
          </Stack>
        </Box>
      </Dialog>
    </Box>
  );
}

Component.displayName = "HomePage";
