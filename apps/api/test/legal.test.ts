import { describe, expect, it } from "vitest";
import { LEGAL_ROUTES, legalOptionsFromEnv, renderLegalPage } from "../src/legal";
import { TIKTOK_SCOPES, YOUTUBE_SCOPES } from "../src/publish/scopes";

describe("legal pages", () => {
  it("serve terms and privacy under English and Spanish paths", () => {
    expect(LEGAL_ROUTES["/terms"]).toBe("terms");
    expect(LEGAL_ROUTES["/terminos"]).toBe("terms");
    expect(LEGAL_ROUTES["/privacy"]).toBe("privacy");
    expect(LEGAL_ROUTES["/privacidad"]).toBe("privacy");
  });

  it("render both languages, the scopes requested and Google's Limited Use statement", () => {
    const html = renderLegalPage("privacy");
    expect(html).toContain("Política de privacidad");
    expect(html).toContain("Privacy Policy");
    for (const scope of [...YOUTUBE_SCOPES, ...TIKTOK_SCOPES]) expect(html).toContain(scope);
    expect(html).toContain("Limited Use");
    const terms = renderLegalPage("terms");
    expect(terms).toContain("Términos del servicio");
    expect(terms).toContain("Terms of Service");
  });

  it("use the configured operator and contact, escaped", () => {
    const opts = legalOptionsFromEnv({ LEGAL_OPERATOR: "Acme <Studio>", LEGAL_CONTACT_EMAIL: "privacy@acme.test" }, "https://app.acme.test/");
    const html = renderLegalPage("terms", opts);
    expect(html).toContain("Acme &lt;Studio&gt;");
    expect(html).not.toContain("Acme <Studio>");
    expect(html).toContain('href="mailto:privacy@acme.test"');
    expect(html).toContain('href="https://app.acme.test/privacy"');
  });

  it("fall back to a generic contact when none is configured", () => {
    const html = renderLegalPage("privacy", legalOptionsFromEnv({}));
    expect(html).toContain("el administrador de esta instancia");
    expect(html).not.toContain("mailto:");
  });
});
