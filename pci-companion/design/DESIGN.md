# PCI Companion visual system

The desktop business-profile concept in this folder is the primary design reference. It was generated with the built-in Image Gen tool for a full functional app screen; it is a design reference, not a runtime website asset.

## Tokens and components

True-white surfaces, cool #f2f5f9 canvas, #0c1630 navy type, #006e68 teal actions, #d4dce6 borders and pale mint guidance. System sans-serif stack with Inter/Segoe UI fallbacks. Desktop sidebar 300px, header 66px, main gutters 28px, desktop heading 48px, form labels 18px, 6px input corners and 10px panel corners. Controls have explicit typography and visible focus outlines. The check mark and navigation icons are code-native vector controls.

The locked initial copy is the wordmark, four navigation items, PCI preparation, Saved on this device, Start with your business, the profile subtitle, Business details, the five field labels, the verification checkbox, Save business profile, How the assistant helps, its four numbered steps, Your answers stay yours and its copy, the preparation note and workspace-import control. Secondary workflow states reuse these components for provider editing, one-question-at-a-time guidance and review.

## Implementation comparison

| Comparison | Concept | Implementation / decision |
|---|---|---|
| Primary composition | Sidebar, top bar, heading, wide form and narrower guidance | Same structure, proportions and content order; checked at requested 1487x1058 viewport. The browser adds its native scrollbar. |
| Copy hierarchy | Profile title, five blank fields, confirmation and primary save action | Exact initial labels and order preserved; dynamic messages appear only after actions. |
| Surfaces and palette | White panels, cool light-grey canvas, navy text, teal primary action | Locked CSS tokens; no photography, gradients, charts or certification badges added. |
| Typography and controls | Bold readable headings, left-aligned labels, ordinary form controls | Explicit heading/control sizes, system sans-serif and accessible labels. Native font rasterisation and select/checkbox rendering vary by browser. |
| Guidance rhythm | Four mint numbered circles above a pale mint privacy note | Same two-block guidance column and spacing system. |
| Responsive behaviour | Desktop reference only | Intentional responsive adaptation: horizontally scrollable navigation and a single-column form/guidance layout on mobile. Checked at 390x844 without horizontal document overflow. |
| Functional states | Provider form, guided answers and review named in design brief | Implemented as real controls with draft state, validation, references and exports; no screenshot-as-interface. |

Browser checks used fictional QA records. QA screenshots and browser-generated exports are outside the source project. The primary preview remains a clean workspace.
