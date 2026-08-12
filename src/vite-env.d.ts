/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_API_ENDPOINT_URL: string;
  readonly VITE_APP_TMDB_V3_API_KEY: string;
  readonly VITE_APP_XTREAM_BASE_URL: string;
  readonly VITE_APP_XTREAM_USERNAME: string;
  readonly VITE_APP_XTREAM_PASSWORD: string;
  readonly VITE_APP_IPTV_PLAYLIST_URL: string;
  readonly VITE_APP_IPTV_M3U_URL: string;
  readonly VITE_APP_IPTV_SSIPTV_URL: string;
  readonly VITE_APP_IPTV_RENEWAL_URL: string;
  readonly VITE_APP_IPTV_EPG_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
