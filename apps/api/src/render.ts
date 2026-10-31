import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { COMPOSITION_ID, type VideoComposition } from "@tsm/video";
import { VIDEO_ENTRY } from "./config";

let bundlePromise: Promise<string> | null = null;

/** Webpack-bundle the Remotion project once per process. */
function getServeUrl(): Promise<string> {
  bundlePromise ??= bundle({ entryPoint: VIDEO_ENTRY }).catch((error) => {
    bundlePromise = null;
    throw error;
  });
  return bundlePromise;
}

export async function renderVideo(
  composition: VideoComposition,
  outputLocation: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const serveUrl = await getServeUrl();
  const inputProps = composition as unknown as Record<string, unknown>;
  const selected = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
  await renderMedia({
    composition: selected,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    onProgress: ({ progress }) => onProgress(progress),
  });
}
