export type DecodedTokenMetadata = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: string | number }>;
};

/**
 * Decode a tokenURI of the form `data:application/json;base64,<base64>`.
 * The HatPet contract always returns this format.
 */
export function decodeTokenURI(uri: string): DecodedTokenMetadata | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) {
    return null;
  }
  const b64 = uri.slice(prefix.length);
  try {
    // atob is fine in modern browsers; for SSR we fall back to Buffer.
    let jsonStr: string;
    if (typeof atob === "function") {
      jsonStr = atob(b64);
    } else {
      jsonStr = Buffer.from(b64, "base64").toString("utf-8");
    }
    return JSON.parse(jsonStr) as DecodedTokenMetadata;
  } catch {
    return null;
  }
}
