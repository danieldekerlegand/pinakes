# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: graph-ui.spec.ts >> graph UI renders against a (mocked) live shared graph >> neighborhood view + provenance badge render for an entity
- Location: e2e/graph-ui.spec.ts:264:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('graph-neighborhood-view').locator('svg')
Expected: visible
Error: strict mode violation: getByTestId('graph-neighborhood-view').locator('svg') resolved to 3 elements:
    1) <svg width="24" height="24" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" class="lucide lucide-network h-4 w-4">…</svg> aka getByRole('img').nth(1)
    2) <svg width="24" height="24" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" class="lucide lucide-book-marked h-2.5 w-2.5">…</svg> aka getByTestId('provenance-kind').getByRole('img')
    3) <svg class="w-full h-full" width="682.0999755859375" height="372.39996337890625">…</svg> aka getByRole('img').filter({ hasText: 'MandarinSino-TibetanCantonese' })

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByTestId('graph-neighborhood-view').locator('svg')

```

# Page snapshot

```yaml
- generic:
  - generic:
    - list
    - generic:
      - link:
        - /url: "#main-content"
        - text: Skip to main content
      - banner:
        - generic:
          - generic:
            - button:
              - img
            - heading [level=1]: Linguistic Family Tree
          - generic:
            - button:
              - generic:
                - img
                - generic: Search...
              - generic:
                - generic: ⌘
                - text: K
            - button:
              - img
              - generic: en
            - button:
              - img
      - generic:
        - generic:
          - button:
            - img
            - generic: Discover Cultures
          - generic: Data
          - combobox:
            - generic: Language Families
            - img
          - img
          - button:
            - generic: Status
            - img
          - combobox:
            - generic: All Regions
            - img
      - generic:
        - navigation:
          - generic:
            - generic:
              - generic:
                - generic:
                  - generic:
                    - generic: Visualizations
                    - generic:
                      - button [pressed]:
                        - img
                        - generic: Family Tree
                      - button:
                        - img
                        - generic: Network
                      - button:
                        - img
                        - generic: Timeline
                      - button:
                        - img
                        - generic: Map
                      - button:
                        - img
                        - generic: 3D Map
                      - button:
                        - img
                        - generic: Explorer
                      - button:
                        - img
                        - generic: Lineage
                      - button:
                        - img
                        - generic: Contribute
                  - generic:
                    - generic: Data
                    - generic:
                      - button:
                        - img
                        - generic: Explore
                      - button:
                        - img
                        - generic: Data Overview
                  - generic:
                    - generic: Tools
                    - generic:
                      - button:
                        - img
                        - generic: Text Analyzer
                      - button:
                        - img
                        - generic: Word Etymology
                      - button:
                        - img
                        - generic: Word Comparison
                      - button:
                        - img
                        - generic: Linguistic Distance
                      - button:
                        - img
                        - generic: Correlation Explorer
                  - generic:
                    - generic: Specialist Views
                    - generic:
                      - button:
                        - img
                        - generic: Phonology (IPA)
                      - button:
                        - img
                        - generic: Grammar Features
                      - button:
                        - img
                        - generic: Writing Systems
                      - button:
                        - img
                        - generic: Verb Paradigms
                      - button:
                        - img
                        - generic: Mesopotamia
                  - generic:
                    - generic: Pages
                    - generic:
                      - button:
                        - img
                        - generic: Stories
                      - button:
                        - img
                        - generic: Quiz
                      - button:
                        - img
                        - generic: Civilizations
                      - button:
                        - img
                        - generic: Scraper
                      - button:
                        - img
                        - generic: AI Review
                      - button:
                        - img
                        - generic: Ancestry (DNA)
                      - button:
                        - img
                        - generic: Hypotheses
                      - button:
                        - img
                        - generic: Immersive (3D)
                      - button:
                        - img
                        - generic: Endangered Langs
                      - button:
                        - img
                        - generic: Living Dataset
        - main:
          - generic:
            - generic:
              - generic:
                - generic:
                  - heading [level=2]: Hierarchical Tree
                  - generic:
                    - generic: 469 families
                    - generic: 1099 languages
                    - generic: 1017 with temporal data
                    - generic: 117 with geographic data
                    - generic: 1 selected
                - button:
                  - img
                  - text: Export
              - generic:
                - generic:
                  - img:
                    - generic:
                      - generic:
                        - generic: Abkhaz-Adyge
                        - generic: ▸
                      - generic:
                        - generic: Afro-Asiatic
                        - generic: ▸
                      - generic:
                        - generic: Ainu
                        - generic: ▸
                      - generic:
                        - generic: Algic
                        - generic: ▸
                      - generic:
                        - generic: Andamanese
                        - generic: ▸
                      - generic:
                        - generic: Araucanian
                        - generic: ▸
                      - generic:
                        - generic: Arawakan
                        - generic: ▸
                      - generic:
                        - generic: Atakapa
                        - generic: ▸
                      - generic:
                        - generic: Austroasiatic
                        - generic: ▸
                      - generic:
                        - generic: Austronesian
                        - generic: ▸
                      - generic:
                        - generic: Aymaran
                        - generic: ▸
                      - generic:
                        - generic: Barbacoan
                        - generic: ▸
                      - generic:
                        - generic: Basque
                        - generic: ▸
                      - generic:
                        - generic: Bunuban
                        - generic: ▸
                      - generic:
                        - generic: Burushaski
                        - generic: ▸
                      - generic:
                        - generic: Caddoan
                        - generic: ▸
                      - generic:
                        - generic: Cariban
                        - generic: ▸
                      - generic:
                        - generic: Chibchan
                        - generic: ▸
                      - generic:
                        - generic: Chinookan
                        - generic: ▸
                      - generic:
                        - generic: Chitimacha
                        - generic: ▸
                      - generic:
                        - generic: Chocoan
                        - generic: ▸
                      - generic:
                        - generic: Chukotko-Kamchatkan
                        - generic: ▸
                      - generic:
                        - generic: Chumashan
                        - generic: ▸
                      - generic:
                        - generic: Daly
                        - generic: ▸
                      - generic:
                        - generic: Dravidian
                        - generic: ▸
                      - generic:
                        - generic: Elamite
                        - generic: ▸
                      - generic:
                        - generic: Eskimo-Aleut
                        - generic: ▸
                      - generic:
                        - generic: Esselen
                        - generic: ▸
                      - generic:
                        - generic: Etruscan
                        - generic: ▸
                      - generic:
                        - generic: Guaicuruan
                        - generic: ▸
                      - generic:
                        - generic: Gunwinyguan
                        - generic: ▸
                      - generic:
                        - generic: Haida
                        - generic: ▸
                      - generic:
                        - generic: Hattic
                        - generic: ▸
                      - generic:
                        - generic: Hmong-Mien
                        - generic: ▸
                      - generic:
                        - generic: Huavean
                        - generic: ▸
                      - generic:
                        - generic: Hurro-Urartian
                        - generic: ▸
                      - generic:
                        - generic: Indo-European
                        - generic: ▸
                      - generic:
                        - generic: Iroquoian
                        - generic: ▸
                      - generic:
                        - generic: Japonic
                        - generic: ▸
                      - generic:
                        - generic: Jarrakan
                        - generic: ▸
                      - generic:
                        - generic: Jivaroan
                        - generic: ▸
                      - generic:
                        - generic: Kartvelian
                        - generic: ▸
                      - generic:
                        - generic: Karuk
                        - generic: ▸
                      - generic:
                        - generic: Keres
                        - generic: ▸
                      - generic:
                        - generic: Khoe
                        - generic: ▸
                      - generic:
                        - generic: Kiowa-Tanoan
                        - generic: ▸
                      - generic:
                        - generic: Klamath-Modoc
                        - generic: ▸
                      - generic:
                        - generic: Koreanic
                        - generic: ▸
                      - generic:
                        - generic: Kra-Dai
                        - generic: ▸
                      - generic:
                        - generic: Kusunda
                        - generic: ▸
                      - generic:
                        - generic: Kx'a
                        - generic: ▸
                      - generic:
                        - generic: Lencan
                        - generic: ▸
                      - generic:
                        - generic: Lower Mamberamo
                        - generic: ▸
                      - generic:
                        - generic: Lule-Vilela
                        - generic: ▸
                      - generic:
                        - generic: Macro-Jê
                        - generic: ▸
                      - generic:
                        - generic: Maiduan
                        - generic: ▸
                      - generic:
                        - generic: Mande
                        - generic: ▸
                      - generic:
                        - generic: Mascoian
                        - generic: ▸
                      - generic:
                        - generic: Matacoan
                        - generic: ▸
                      - generic:
                        - generic: Mayan
                        - generic: ▸
                      - generic:
                        - generic: Misumalpan
                        - generic: ▸
                      - generic:
                        - generic: Mixe-Zoque
                        - generic: ▸
                      - generic:
                        - generic: Mongolic
                        - generic: ▸
                      - generic:
                        - generic: Muskogean
                        - generic: ▸
                      - generic:
                        - generic: Na-Dene
                        - generic: ▸
                      - generic:
                        - generic: Nakh-Daghestanian
                        - generic: ▸
                      - generic:
                        - generic: Natchez
                        - generic: ▸
                      - generic:
                        - generic: Niger-Congo
                        - generic: ▸
                      - generic:
                        - generic: Nihali
                        - generic: ▸
                      - generic:
                        - generic: Nilo-Saharan
                        - generic: ▸
                      - generic:
                        - generic: Nivkh
                        - generic: ▸
                      - generic:
                        - generic: Nyulnyulan
                        - generic: ▸
                      - generic:
                        - generic: Otomanguean
                        - generic: ▸
                      - generic:
                        - generic: Pama-Nyungan
                        - generic: ▸
                      - generic:
                        - generic: Panoan
                        - generic: ▸
                      - generic:
                        - generic: Pomoan
                        - generic: ▸
                      - generic:
                        - generic: Purépecha
                        - generic: ▸
                      - generic:
                        - generic: Quechuan
                        - generic: ▸
                      - generic:
                        - generic: Sahaptian
                        - generic: ▸
                      - generic:
                        - generic: Salinan
                        - generic: ▸
                      - generic:
                        - generic: Salishan
                        - generic: ▸
                      - generic:
                        - generic: Sepik
                        - generic: ▸
                      - generic:
                        - generic: Seri
                        - generic: ▸
                      - generic:
                        - generic: Sino-Tibetan
                        - generic: ▸
                      - generic:
                        - generic: Siouan-Catawban
                        - generic: ▸
                      - generic:
                        - generic: Skou
                        - generic: ▸
                      - generic:
                        - generic: Songhay
                        - generic: ▸
                      - generic:
                        - generic: Sumerian
                        - generic: ▸
                      - generic:
                        - generic: Timucua
                        - generic: ▸
                      - generic:
                        - generic: Tiwi
                        - generic: ▸
                      - generic:
                        - generic: Tonkawa
                        - generic: ▸
                      - generic:
                        - generic: Torricelli
                        - generic: ▸
                      - generic:
                        - generic: Totonacan
                        - generic: ▸
                      - generic:
                        - generic: Trans-New Guinea
                        - generic: ▸
                      - generic:
                        - generic: Tsimshianic
                        - generic: ▸
                      - generic:
                        - generic: Tucanoan
                        - generic: ▸
                      - generic:
                        - generic: Tungusic
                        - generic: ▸
                      - generic:
                        - generic: Tunica
                        - generic: ▸
                      - generic:
                        - generic: Tupian
                        - generic: ▸
                      - generic:
                        - generic: Turkic
                        - generic: ▸
                      - generic:
                        - generic: Tuu
                        - generic: ▸
                      - generic:
                        - generic: Uralic
                        - generic: ▸
                      - generic:
                        - generic: Utian
                        - generic: ▸
                      - generic:
                        - generic: Uto-Aztecan
                        - generic: ▸
                      - generic:
                        - generic: Wakashan
                        - generic: ▸
                      - generic:
                        - generic: Washo
                        - generic: ▸
                      - generic:
                        - generic: Wintuan
                        - generic: ▸
                      - generic:
                        - generic: Witotoan
                        - generic: ▸
                      - generic:
                        - generic: Worrorran
                        - generic: ▸
                      - generic:
                        - generic: Xincan
                        - generic: ▸
                      - generic:
                        - generic: Yeniseian
                        - generic: ▸
                      - generic:
                        - generic: Yukaghir
                        - generic: ▸
                      - generic:
                        - generic: Yukian
                        - generic: ▸
                      - generic:
                        - generic: Yuman
                        - generic: ▸
                      - generic:
                        - generic: Zamucoan
                        - generic: ▸
                      - generic:
                        - generic: Zaparoan
                        - generic: ▸
                      - generic:
                        - generic: Zuni
                        - generic: ▸
                  - generic: Click a family to expand • Scroll to zoom • Drag to pan
      - generic:
        - generic:
          - generic:
            - generic:
              - generic:
                - heading [level=2]: Mandarin普通话 (Pǔtōnghuà) / 國語 (Guóyǔ)
              - button:
                - img
          - generic:
            - generic:
              - generic:
                - heading [level=3]: Basic Information
                - generic:
                  - generic:
                    - generic: "Family:"
                    - generic:
                      - button:
                        - img
                  - generic:
                    - generic: "ISO 639-1:"
                    - generic: zh
                  - generic:
                    - generic: "Status:"
                    - generic:
                      - generic: living
                      - button:
                        - img
              - generic:
                - heading [level=3]: Geographic Distribution
                - generic:
                  - generic:
                    - generic: "Region:"
                    - generic:
                      - text: China, Taiwan, Singapore
                      - button:
                        - img
                  - generic:
                    - generic: "Countries:"
                    - generic: 4 countries
              - generic:
                - heading [level=3]: Speaker Statistics
                - generic:
                  - generic:
                    - generic:
                      - generic: "Native Speakers:"
                      - generic: 920,000,000
                  - generic:
                    - generic:
                      - generic: "Total Speakers:"
                      - generic: 1,120,000,000
              - generic:
                - heading [level=3]: Actions
                - generic:
                  - button:
                    - img
                    - text: Scrape Word List
                  - button:
                    - img
                    - text: Show in graph
              - generic:
                - button:
                  - generic:
                    - img
                    - text: Sample Texts
                  - img
              - generic:
                - button:
                  - img
                  - text: Add to collection
              - generic:
                - heading [level=3]:
                  - img
                  - text: Related entities
                - list:
                  - listitem:
                    - generic:
                      - link:
                        - /url: /advanced-tools?graph=cs%3Alanguage%3Ayue
                        - text: Cantonese
                      - generic:
                        - generic: Related to
                        - generic: Language
                  - listitem:
                    - generic:
                      - link:
                        - /url: /advanced-tools?graph=cs%3Afamily%3Asino_tibetan
                        - text: Sino-Tibetan
                      - generic:
                        - generic: Member of
                        - generic: LanguageFamily
              - generic:
                - generic:
                  - img
                  - heading [level=3]: Your notes
                  - generic: — personal annotations, separate from the curated data
                - generic:
                  - textbox:
                    - /placeholder: Add your own note about this entity…
                  - generic:
                    - generic:
                      - checkbox
                      - text: Share publicly
                    - button [disabled]: Add note
                - paragraph: No notes yet.
              - generic:
                - heading [level=4]: Suggested Visualizations
                - generic:
                  - button:
                    - img
                    - text: Map
                  - button:
                    - img
                    - text: Family Tree
                  - button:
                    - img
                    - text: Timeline
                  - button:
                    - img
                    - text: Network
                - paragraph: Click to switch visualization view
      - generic:
        - button:
          - img
      - button
  - dialog "Mandarin in the shared graph" [ref=e2]:
    - generic [ref=e3]:
      - heading "Mandarin in the shared graph" [level=2] [ref=e4]:
        - img [ref=e5]
        - text: Mandarin in the shared graph
      - paragraph [ref=e11]: Cultural connections for this entity in the pinakes-engine graph.
    - generic [ref=e13]:
      - generic [ref=e14]:
        - generic [ref=e15]:
          - img [ref=e16]
          - text: Mandarin
          - generic [ref=e21]:
            - generic "Sourced fact — has an external citation" [ref=e22]:
              - img [ref=e23]
              - text: Sourced
            - generic "Confidence" [ref=e26]: 90%
        - group "Traversal depth" [ref=e27]:
          - generic [ref=e28]: Depth
          - button "1" [pressed] [ref=e29] [cursor=pointer]
          - button "2" [ref=e30] [cursor=pointer]
          - button "3" [ref=e31] [cursor=pointer]
      - generic [ref=e32]:
        - generic [ref=e33]: Language
        - generic [ref=e35]: LanguageFamily
      - generic [ref=e38]:
        - img [ref=e39]:
          - generic [ref=e40]:
            - generic: Mandarin
            - generic: Sino-Tibetan
            - generic: Cantonese
        - generic [ref=e46]: Drag nodes · Scroll to zoom · Drag background to pan
    - button "Close" [active] [ref=e47] [cursor=pointer]:
      - img [ref=e48]
      - generic [ref=e51]: Close
```

# Test source

```ts
  187 | }
  188 | 
  189 | // ─────────────────────────────────────────────────────────────────────────────
  190 | // Graph DOWN — real server, no mocks. Every feature must degrade gracefully.
  191 | // ─────────────────────────────────────────────────────────────────────────────
  192 | 
  193 | test.describe("graph UI degrades gracefully when the shared graph is down", () => {
  194 |   test("Show-in-graph is gated (dimmed + tooltip) on an entity panel", async ({
  195 |     page,
  196 |   }) => {
  197 |     await page.goto(`/?langDetail=${LANGUAGE_ID}`);
  198 |     // The language detail panel opened straight from the URL state.
  199 |     await expect(
  200 |       page.getByTestId("text-detail-title-mandarin"),
  201 |     ).toBeVisible();
  202 | 
  203 |     // The "Show in graph" trigger is wrapped in GraphFeatureGate(neo4j); with
  204 |     // Neo4j down it renders the disabled, tooltip-explained affordance rather
  205 |     // than a clickable-but-broken button.
  206 |     const gate = page.getByTestId("graph-feature-gate-disabled");
  207 |     await expect(gate).toBeVisible();
  208 |     // The (real, un-mocked) button still exists inside the pointer-events-none
  209 |     // wrapper — it's the child being gated, not removed.
  210 |     await expect(page.getByTestId("button-show-in-graph")).toBeAttached();
  211 | 
  212 |     // Hovering the gate surfaces the explanatory tooltip (AC: confirmed when
  213 |     // the graph is down).
  214 |     await gate.hover();
  215 |     await expect(page.getByText(/offline|unavailable/i).first()).toBeVisible();
  216 | 
  217 |     await page.screenshot({ path: `${SHOTS}/down-showingraph-gate.png` });
  218 |   });
  219 | 
  220 |   test("the research console gate is disabled with a tooltip", async ({
  221 |     page,
  222 |   }) => {
  223 |     await page.goto("/advanced-tools");
  224 |     await expect(page.getByTestId("advanced-tools-page")).toBeVisible();
  225 |     const gate = page.getByTestId("graph-feature-gate-disabled").first();
  226 |     await expect(gate).toBeVisible();
  227 |     await gate.hover();
  228 |     await expect(page.getByText(/offline|unavailable/i).first()).toBeVisible();
  229 |   });
  230 | 
  231 |   test("the explorer graph adapter shows its error state", async ({ page }) => {
  232 |     // `panel=explore` mounts UnifiedExplorer; `ds=pinakes_engine-graph` selects
  233 |     // the shared-graph adapter, whose single GET to /api/graph/overview 503s
  234 |     // when Neo4j is down.
  235 |     await page.goto("/?panel=explore&ds=pinakes_engine-graph");
  236 |     await expect(page.getByText(/Failed to load/i)).toBeVisible();
  237 |     await page.screenshot({ path: `${SHOTS}/down-explorer-adapter.png` });
  238 |   });
  239 | 
  240 |   test("federated search returns local hits and no graph results", async ({
  241 |     page,
  242 |   }) => {
  243 |     await page.goto("/");
  244 |     const input = await openSearch(page);
  245 |     await input.fill("Mandarin");
  246 |     // The server merges graph hits only when the graph is up; with it down the
  247 |     // dialog resolves with no "Graph"-sourced results and no crash.
  248 |     await expect(page.getByText(/Searching|No results|item/i).first())
  249 |       .toBeVisible()
  250 |       .catch(() => {});
  251 |     await expect(page.getByText("Graph", { exact: true })).toHaveCount(0);
  252 |   });
  253 | });
  254 | 
  255 | // ─────────────────────────────────────────────────────────────────────────────
  256 | // Graph UP — /api/graph/* + /api/search mocked. Verify the happy-path renders.
  257 | // ─────────────────────────────────────────────────────────────────────────────
  258 | 
  259 | test.describe("graph UI renders against a (mocked) live shared graph", () => {
  260 |   test.beforeEach(async ({ page }) => {
  261 |     await mockGraphUp(page);
  262 |   });
  263 | 
  264 |   test("neighborhood view + provenance badge render for an entity", async ({
  265 |     page,
  266 |   }) => {
  267 |     await page.goto(`/?langDetail=${LANGUAGE_ID}`);
  268 |     await expect(
  269 |       page.getByTestId("text-detail-title-mandarin"),
  270 |     ).toBeVisible();
  271 | 
  272 |     // With Neo4j "up" the gate passes the child through — the button is live.
  273 |     const button = page.getByTestId("button-show-in-graph");
  274 |     await expect(button).toBeVisible();
  275 |     await button.click();
  276 | 
  277 |     // Dialog resolves the entity → csid, then lazy-loads the neighborhood view.
  278 |     const view = page.getByTestId("graph-neighborhood-view");
  279 |     await expect(view).toBeVisible();
  280 |     // Depth controls (1..3) are present.
  281 |     await expect(page.getByTestId("graph-depth-2")).toBeVisible();
  282 |     // Provenance UI: the root node is a sourced fact → the badge renders as such.
  283 |     const kind = page.getByTestId("provenance-kind").first();
  284 |     await expect(kind).toBeVisible();
  285 |     await expect(kind).toHaveAttribute("data-kind", "sourced");
  286 |     // The force graph mounted its SVG (nodes to draw).
> 287 |     await expect(view.locator("svg")).toBeVisible();
      |                                       ^ Error: expect(locator).toBeVisible() failed
  288 | 
  289 |     await page.screenshot({ path: `${SHOTS}/up-neighborhood.png` });
  290 |   });
  291 | 
  292 |   test("the explorer graph adapter loads the Shared Culture Graph", async ({
  293 |     page,
  294 |   }) => {
  295 |     await page.goto("/?panel=explore&ds=pinakes_engine-graph");
  296 |     // No error state, and the projected item count reflects the overview nodes.
  297 |     await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
  298 |     await expect(page.getByText(/[1-9]\d* items/)).toBeVisible();
  299 |     await page.screenshot({ path: `${SHOTS}/up-explorer-adapter.png` });
  300 |   });
  301 | 
  302 |   test("federated search surfaces a graph-sourced result", async ({ page }) => {
  303 |     await page.goto("/");
  304 |     const input = await openSearch(page);
  305 |     await input.fill("mandarin");
  306 |     // The graph-sourced hit is tagged with the purple "Graph" source badge and
  307 |     // carries its provenance (source id) inline.
  308 |     await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
  309 |     await expect(page.getByText("pinakes-engine").first()).toBeVisible();
  310 |     await page.screenshot({ path: `${SHOTS}/up-federated-search.png` });
  311 |   });
  312 | });
  313 | 
```