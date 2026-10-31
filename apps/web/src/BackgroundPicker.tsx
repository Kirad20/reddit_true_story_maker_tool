import type { BackgroundChoice, Options } from "./api";

const PRESET_COLORS: Record<string, string> = {
  sunset: "linear-gradient(160deg, #ff7e5f, #6a3093)",
  ocean: "linear-gradient(160deg, #00c6ff, #0b2a6f)",
  neon: "linear-gradient(160deg, #ff00e5, #302b63)",
};

const PRESET_LABELS: Record<string, string> = { sunset: "Atardecer", ocean: "Océano", neon: "Neón" };

function sameChoice(a: BackgroundChoice, b: BackgroundChoice): boolean {
  if (a.type === "procedural" && b.type === "procedural") return a.preset === b.preset;
  if (a.type === "clip" && b.type === "clip") return a.category === b.category && a.file === b.file;
  return false;
}

export function BackgroundPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Options;
  value: BackgroundChoice;
  onChange: (value: BackgroundChoice) => void;
  disabled?: boolean;
}) {
  const category = value.type === "clip" ? value.category : "__procedural";
  const current = options.backgrounds.find((c) => c.name === category);

  return (
    <div className="bg-picker">
      <div className="chips" role="radiogroup" aria-label="Categoría de fondo">
        <button
          type="button"
          role="radio"
          aria-checked={category === "__procedural"}
          className={`chip ${category === "__procedural" ? "on" : ""}`}
          disabled={disabled}
          onClick={() => onChange({ type: "procedural", preset: options.procedural[0] ?? "sunset" })}
        >
          Animado
        </button>
        {options.backgrounds.map((c) => (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={category === c.name}
            className={`chip ${category === c.name ? "on" : ""}`}
            disabled={disabled}
            onClick={() => onChange({ type: "clip", category: c.name })}
          >
            {c.name} <span className="muted">{c.clips.length}</span>
          </button>
        ))}
      </div>

      <div className="thumbs" role="radiogroup" aria-label="Fondo">
        {category === "__procedural"
          ? options.procedural.map((preset) => {
              const choice: BackgroundChoice = { type: "procedural", preset };
              return (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={sameChoice(value, choice)}
                  className={`thumb ${sameChoice(value, choice) ? "on" : ""}`}
                  style={{ background: PRESET_COLORS[preset] }}
                  disabled={disabled}
                  onClick={() => onChange(choice)}
                >
                  <span>{PRESET_LABELS[preset] ?? preset}</span>
                </button>
              );
            })
          : current && (
              <>
                <button
                  type="button"
                  role="radio"
                  aria-checked={value.type === "clip" && !value.file}
                  className={`thumb shuffle ${value.type === "clip" && !value.file ? "on" : ""}`}
                  disabled={disabled}
                  onClick={() => onChange({ type: "clip", category: current.name })}
                >
                  <span>Aleatorio</span>
                </button>
                {current.clips.map((file) => {
                  const choice: BackgroundChoice = { type: "clip", category: current.name, file };
                  return (
                    <button
                      key={file}
                      type="button"
                      role="radio"
                      aria-checked={sameChoice(value, choice)}
                      className={`thumb ${sameChoice(value, choice) ? "on" : ""}`}
                      disabled={disabled}
                      onClick={() => onChange(choice)}
                      title={file}
                    >
                      <video
                        src={`/media/assets/backgrounds/${encodeURIComponent(current.name)}/${encodeURIComponent(file)}#t=2`}
                        muted
                        preload="metadata"
                      />
                    </button>
                  );
                })}
              </>
            )}
      </div>
      {options.assetsError && <p className="warn">{options.assetsError}</p>}
      {options.backgrounds.length === 0 && !options.assetsError && (
        <p className="hint">
          {options.assetStorage === "s3" ? (
            <>
              Para usar gameplay, sube tus clips al bucket en <code>backgrounds/&lt;categoría&gt;/</code> (por ejemplo{" "}
              <code>backgrounds/minecraft/parkour1.mp4</code>) o usa <code>npm run assets:push</code>.
            </>
          ) : (
            <>
              Para usar gameplay, pon tus clips en <code>assets/backgrounds/&lt;categoría&gt;/</code> (por ejemplo{" "}
              <code>assets/backgrounds/minecraft/parkour1.mp4</code>).
            </>
          )}
        </p>
      )}
    </div>
  );
}
