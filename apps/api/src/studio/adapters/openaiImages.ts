import type OpenAI from "openai";
import type { ImageAspect } from "../domain";
import type { ImageGenerator } from "../ports";

export const imageSize = (aspect: ImageAspect) => ({ square: "1024x1024", portrait: "1024x1536", landscape: "1536x1024" })[aspect];

type Resolved = { client: OpenAI; model: string } | null;

/** Text-to-image through an OpenAI-compatible Images API. */
export class OpenAIImageGenerator implements ImageGenerator {
  constructor(
    private resolve: () => Resolved,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async generate(prompt: string, aspect: ImageAspect): Promise<Buffer> {
    const r = this.resolve();
    if (!r) throw new Error("La generación de imágenes necesita un proveedor OpenAI-compatible (Ajustes → Modelos de IA → Imágenes)");
    const res = await r.client.images.generate({ model: r.model, prompt, size: imageSize(aspect), n: 1 } as never);
    const item = (res as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
    if (item?.url) {
      const download = await this.fetchImpl(item.url);
      if (!download.ok) throw new Error(`No se pudo descargar la imagen (${download.status})`);
      return Buffer.from(await download.arrayBuffer());
    }
    throw new Error("El proveedor no devolvió ninguna imagen");
  }
}
