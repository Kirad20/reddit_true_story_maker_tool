import type { Platform } from "../domain";
import {
  FORMATS_BY_PLATFORM,
  IMAGE_PLATFORMS,
  imageAspect,
  normalizePost,
  postText,
  summarizeMetrics,
  TEXT_ONLY_PLATFORMS,
  type Brand,
  type ContentKind,
  type Draft,
  type DraftStatus,
  type GeneratedContent,
  type MetricsSummary,
  type PlanContent,
  type PostFormat,
  type PostMetric,
} from "./domain";
import type { ContentGenerator, DraftRepository, LocalPublicationReader, ImageGenerator, ImageStore, MetricsProvider, SocialPublisher } from "./ports";

export type StudioDeps = {
  generator: ContentGenerator;
  drafts: DraftRepository;
  metrics: MetricsProvider | null;
  local: LocalPublicationReader;
  publisher?: SocialPublisher;
  images?: ImageGenerator;
  imageStore?: ImageStore;
  brand: () => Brand;
  newId: () => string;
  now: () => Date;
};

export type GenerateInput = { kind: ContentKind; topic: string; platforms?: Platform[]; days?: number; formats?: Partial<Record<Platform, PostFormat>> };

export type AnalyticsReport = { source: "remote" | "local"; summary: MetricsSummary; insights?: string[] };

export type AutomationResult = { plan: PlanContent; drafts: Draft[]; errors: string[] };

const DEFAULT_PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube", "facebook"];

export class StudioService {
  constructor(private d: StudioDeps) {}

  async generate(input: GenerateInput): Promise<Draft> {
    const topic = input.topic.trim();
    if (!topic) throw new Error("Indica un tema");
    const base = { topic, brand: this.d.brand() };
    const platforms = input.platforms?.length ? input.platforms : DEFAULT_PLATFORMS;
    let content: GeneratedContent;
    switch (input.kind) {
      case "post": {
        for (const [p, f] of Object.entries(input.formats ?? {}) as [Platform, PostFormat][]) {
          if (!FORMATS_BY_PLATFORM[p]?.includes(f)) throw new Error(`Formato no soportado en ${p}: ${f}`);
        }
        const post = await this.d.generator.post({ ...base, platforms, formats: input.formats });
        content = { kind: "post", variants: post.variants.map(normalizePost) };
        break;
      }
      case "ads":
        content = await this.d.generator.ads(base);
        break;
      case "seo":
        content = await this.d.generator.seo(base);
        break;
      case "video":
        content = await this.d.generator.video(base);
        break;
      case "plan":
        content = await this.d.generator.plan({ ...base, platforms, days: input.days ?? 7 });
        break;
      default:
        throw new Error(`Tipo de contenido no soportado: ${String(input.kind)}`);
    }
    return this.d.drafts.save({ id: this.d.newId(), kind: content.kind, topic, status: "draft", createdAt: this.d.now().toISOString(), content });
  }

  async list(): Promise<Draft[]> {
    return (await this.d.drafts.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setStatus(id: string, status: DraftStatus): Promise<Draft> {
    const draft = await this.d.drafts.get(id);
    if (!draft) throw new Error(`Draft not found: ${id}`);
    return this.d.drafts.save({ ...draft, status });
  }

  remove(id: string): Promise<void> {
    return this.d.drafts.remove(id);
  }

  /** Publishes one text variant of an approved post draft. Media platforms go through the video pipeline. */
  async publish(id: string, platform: Platform): Promise<Draft> {
    const draft = await this.d.drafts.get(id);
    if (!draft) throw new Error(`Draft not found: ${id}`);
    if (!this.d.publisher) throw new Error("No hay cuenta para publicar (conecta Zernio)");
    if (draft.kind !== "post" || draft.content.kind !== "post") throw new Error("Solo se pueden publicar borradores de tipo publicación");
    if (draft.status !== "approved") throw new Error("Aprueba el borrador antes de publicar");
    if (!IMAGE_PLATFORMS.includes(platform)) throw new Error(`${platform} requiere video: usa el flujo de video`);
    if (draft.published?.some((p) => p.platform === platform)) throw new Error(`Este borrador ya se publicó en ${platform}`);
    const variant = draft.content.variants.find((v) => v.platform === platform);
    if (!variant) throw new Error(`El borrador no tiene variante para ${platform}`);
    if (!TEXT_ONLY_PLATFORMS.includes(platform) && !variant.imageUrl) throw new Error(`Genera una imagen antes de publicar en ${platform}`);
    const { url } = await this.d.publisher.publishPost(platform, postText(variant), variant.imageUrl ?? null);
    return this.d.drafts.save({ ...draft, published: [...(draft.published ?? []), { platform, at: this.d.now().toISOString(), url }] });
  }

  /** Generates the illustration of one variant (from its image prompt, or topic + copy) and attaches it. */
  async illustrate(id: string, platform: Platform): Promise<Draft> {
    const draft = await this.d.drafts.get(id);
    if (!draft) throw new Error(`Draft not found: ${id}`);
    if (!this.d.images || !this.d.imageStore) throw new Error("La generación de imágenes no está configurada (Ajustes → Modelos de IA → Imágenes)");
    if (draft.content.kind !== "post") throw new Error("Solo las publicaciones llevan imagen");
    const content = draft.content;
    const index = content.variants.findIndex((v) => v.platform === platform);
    if (index < 0) throw new Error(`El borrador no tiene variante para ${platform}`);
    const variant = content.variants[index];
    const brand = this.d.brand();
    const prompt = [
      variant.imagePrompt || `${draft.topic}. ${variant.text.slice(0, 200)}`,
      `Brand: ${brand.name}${brand.niche ? `, ${brand.niche}` : ""}. Clean social media visual, no text or watermarks, no real people's faces.`,
    ].join("\n");
    const png = await this.d.images.generate(prompt, imageAspect(platform, variant.format ?? "image"));
    const { url } = await this.d.imageStore.save(png);
    const variants = content.variants.map((v, i) => (i === index ? { ...v, imageUrl: url } : v));
    return this.d.drafts.save({ ...draft, content: { ...content, variants } });
  }

  async analytics(opts: { withInsights?: boolean } = {}): Promise<AnalyticsReport> {
    let source: AnalyticsReport["source"] = "local";
    let metrics: PostMetric[] = [];
    if (this.d.metrics) {
      try {
        metrics = await this.d.metrics.fetch();
        source = "remote";
      } catch {
        metrics = [];
      }
    }
    if (source === "local") {
      metrics = this.d.local.published().map((p) => ({ ...p, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 }));
    }
    const summary = summarizeMetrics(metrics);
    const report: AnalyticsReport = { source, summary };
    if (opts.withInsights) report.insights = await this.d.generator.insights({ brand: this.d.brand(), summary });
    return report;
  }

  /** The AI agent run: plan the period, then draft a post for each plan item. Never publishes by itself. */
  async runAutomation(opts: { platforms?: Platform[]; maxDrafts?: number; theme?: string }): Promise<AutomationResult> {
    const brand = this.d.brand();
    const platforms = opts.platforms?.length ? opts.platforms : DEFAULT_PLATFORMS;
    const planDraft = await this.generate({ kind: "plan", topic: opts.theme?.trim() || brand.niche || brand.name, platforms });
    const plan = planDraft.content as PlanContent;
    const drafts: Draft[] = [];
    const errors: string[] = [];
    for (const item of plan.items.slice(0, opts.maxDrafts ?? 3)) {
      try {
        drafts.push(await this.generate({ kind: "post", topic: item.topic, platforms: [item.platform] }));
      } catch (e) {
        errors.push(`${item.topic}: ${(e as Error).message}`);
      }
    }
    return { plan, drafts, errors };
  }
}
