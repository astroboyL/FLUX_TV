export type IptvContentType = "live" | "movie" | "series";

export type IptvChannel = {
  id: string;
  name: string;
  url: string;
  contentType: IptvContentType;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
};
