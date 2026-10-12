# Catsco Interface Alignment

The OA uses the Catsco webapp interface conventions from the local checkout
`E:/CodexProjects/cats-company-latest-20260920/webapp/src`, while preserving its
blue action color, navy sidebar and business status palette.

## Sources

| OA implementation | Catsco source |
| --- | --- |
| Fonts, radii, sidebar sizes, scrollbars | `css/catsco-ui-system.css` |
| Secondary actions, compact controls | `css/catsco-secondary-surfaces.css` |
| Modal headers and close controls | `css/catsco-secondary-headers.css` |
| Contained input feedback | `css/catsco-input-states.css` |
| Keyboard versus pointer focus | `css/catsco-focus-policy.css` |
| Tooltip delay and positioning | `components/app-tooltip.jsx` |
| Segmented controls and switches | `css/catsco-settings-controls.css` |

`src/lib/styles/catsco-system.css` owns the shared geometry and maps Catsco
semantic color roles to the OA palette. It loads after the existing business
styles. `AppInteractions.svelte` supplies tooltips and dialog focus management.

## Shared Conventions

- Fonts: Inter Variable, Noto Sans SC Variable and JetBrains Mono Variable.
- Radii: 6px, 8px and 12px; confirmation dialogs follow Catsco's 16px radius.
- Sidebar: 220px default for the compact OA list, 64px collapsed; resize range 220px to 360px.
- Standard actions and fields: 36px; compact icon actions: 34px.
- Menu rows: 40px with 11px inline padding and 10px gaps.
- Tooltip: 320ms pointer delay, immediate keyboard feedback, 10px target gap.
- Dialogs: contained focus, inert background, Escape, focus restoration and
  scrolling bodies with fixed headers and footers.
- Responsive navigation: a 56px top bar and an overlay sidebar below 760px.
- Reduced motion disables transitions and entry animations.

## Order List Refinements

- Search, customer, payment status and the date range remain visible; project,
  designer, owner and creator filters expand on demand. Applied conditions have
  individually removable labels.
- Filtered statistics follow the filters and include all matching pages. Sorting
  lives alongside field visibility and batch actions above the table.
- Secondary order controls use white surfaces and visible borders against the
  existing gray page background. Blue actions and the status palette are preserved.
- Export remains available from each order's menu and from batch mode. The export
  dialog lists only selected orders and switches between detail and settlement tabs.

## Other Workbench Lists

- Reimbursements, review, history, catalog and employees share white filter and
  statistics bands, removable conditions, bordered secondary buttons and compact
  left-aligned tables. Statistics describe the current matching records.
- Review presents its matching count and total once beside the table heading,
  without a separate statistics band or repeated stage counts. It uses the same
  person filter for its list and export. History export uses
  the matching record IDs so keyword conditions are included.
- History's per-person summary and catalog source configuration expand on demand.
- Employee creation uses a dialog. Search, department, role and active filters
  match saved records so editing a row does not hide it before saving. Employee
  permissions reload after creation and save.
- Narrow screens wrap filters and statistics; wide business tables scroll within
  their own containers.

## Local Preview

Start with `OA_TEST_AUTH_BYPASS=1`, `DATABASE_PATH=./data/preview-demo.db`,
`ORIGIN=http://127.0.0.1:5180` and
`npm run dev -- --host 127.0.0.1 --port 5180`.

Open `/orders` once to initialize the database, then run `npm run seed:preview`.
The seed script only targets localhost and the separate preview database.
