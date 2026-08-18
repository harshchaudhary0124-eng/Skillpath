// Skillpath — Courses Section (Framer Code Component)
//
// Renders a live course catalog from the assignment API with four course
// states (loading / error / empty / ready) and best-effort currency.
//
// Architecture reference: see DECISIONS.md at the repo root.

import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import { addPropertyControls, ControlType } from "framer"

// ---------------------------------------------------------------------------
// API reference
// Verified live with GET-only requests before implementation (see DECISIONS.md).
// ---------------------------------------------------------------------------
const API_BASE_URL = "https://syncsphere-hiv6.onrender.com"
const COURSES_ENDPOINT = `${API_BASE_URL}/assignment/course-data`
const COUNTRY_ENDPOINT = `${API_BASE_URL}/assignment/country-code`

// Number of placeholder cards shown while courses load. The real count is
// unknown until the request resolves, so this is a display-only value.
const SKELETON_COUNT = 6

// Responsive grid — explicit 3 / 2 / 1 columns (desktop / tablet / mobile).
// Column count is driven purely by CSS media queries (no JS width detection),
// so it is defined at every intermediate width. Fixed `repeat(N, 1fr)` tracks
// keep every card the same width for any 5–10 count: a short final row stays
// left-aligned instead of stretching a lone card across the row.
const GRID_CLASS = "skillpath-courses-grid"
const GRID_CSS = `
.${GRID_CLASS} {
    display: grid;
    gap: 24px;
    grid-template-columns: 1fr;            /* mobile: 1 column */
}
@media (min-width: 768px) {
    .${GRID_CLASS} {
        grid-template-columns: repeat(2, 1fr);   /* tablet: 2 columns */
    }
}
@media (min-width: 1024px) {
    .${GRID_CLASS} {
        grid-template-columns: repeat(3, 1fr);   /* desktop: 3 columns */
    }
}
`

// Rules that can't be expressed as inline styles, in one injected sheet:
//  - responsive padding for the section and cards (media queries)
//  - the card skin (border/shadow) — kept here, not inline, so the :hover rule
//    can actually override it (inline styles would win over a CSS :hover)
//  - the hover lift itself (a :hover pseudo), disabled under reduced-motion
const SECTION_CLASS = "skillpath-courses-section"
const CARD_BASE_CLASS = "skillpath-card"
const CARD_HOVER_CLASS = "skillpath-course-card"
const TOOLBAR_CLASS = "skillpath-toolbar"
const SEARCH_CLASS = "skillpath-search"
const SORT_CLASS = "skillpath-sort"
const COMPONENT_CSS = `
.${SECTION_CLASS} {
    padding: 88px 24px;
}
.${CARD_BASE_CLASS} {
    padding: 24px;
    border: 1px solid #EAECF0;
    border-radius: 16px;
    background-color: #FFFFFF;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06);
}
.${CARD_HOVER_CLASS} {
    transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}
.${CARD_HOVER_CLASS}:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 28px rgba(16, 24, 40, 0.10);
    border-color: #D0D5DD;
}
@media (max-width: 767px) {
    .${SECTION_CLASS} { padding: 56px 20px; }
    .${CARD_BASE_CLASS} { padding: 20px; }
}
@media (prefers-reduced-motion: reduce) {
    .${CARD_HOVER_CLASS} { transition: none; }
    .${CARD_HOVER_CLASS}:hover { transform: none; }
}
.${TOOLBAR_CLASS} {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 24px;
}
.${SEARCH_CLASS} {
    position: relative;
    flex: 1 1 240px;               /* grows; search + sort share one row */
}
.${SORT_CLASS} {
    flex: 0 0 auto;
}
.${SEARCH_CLASS} input::placeholder {
    color: #98A2B3;
}
@media (max-width: 559px) {
    .${TOOLBAR_CLASS} { flex-direction: column; }   /* mobile: stack */
    /* In a column flex, a "flex: 1 1 240px" basis becomes a 240px MAIN-AXIS
       (height) — the source of the tall empty box. Reset it so the wrapper
       hugs the input height and the icon stays centered inside it. */
    .${SEARCH_CLASS} { flex: 0 0 auto; width: 100%; }
    .${SORT_CLASS} { width: 100%; }
}
`

// ---------------------------------------------------------------------------
// Domain types
// The Course shape is the exact contract confirmed against the live API.
// ---------------------------------------------------------------------------
interface Course {
    courseName: string
    courseCode: string
    description: string
    mainCategory: string
    shortCourse: string
    courseType: string
    pricePaise: number
    priceUsdCents: number
    mangoId: string
    refundable: boolean
}

// The two price fields map to two currencies. They are never converted
// against each other — the country endpoint only selects which one to show.
type Currency = "INR" | "USD"

// Independent state models.
// Courses is the CRITICAL dependency: without it there is no grid to render.
type CoursesState =
    | { status: "loading" }
    | { status: "error" }
    | { status: "empty" }
    | { status: "ready"; courses: Course[] }

// Country is BEST-EFFORT: it only decides currency. On failure the grid still
// renders and prices show as temporarily unavailable (see DECISIONS.md #4).
type CountryState =
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; currency: Currency }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// GET a URL and return its parsed JSON body.
// Failures arrive as HTTP status codes (404/500), which fetch RESOLVES rather
// than rejects — so response.ok is checked explicitly. A non-OK status or an
// unparseable body both throw, surfacing to the caller's catch as an error.
async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { method: "GET", signal })
    if (!response.ok) {
        throw new Error(`Request to ${url} failed with ${response.status}`)
    }
    return response.json()
}

// Map the country payload to a currency. Returns null for any unexpected shape
// or value — the country is deliberately never defaulted to INR or USD.
function toCurrency(data: unknown): Currency | null {
    const code = (data as { country_code?: unknown } | null)?.country_code
    if (code === "IN") return "INR"
    if (code === "US") return "USD"
    return null
}

// Format a course's price in the given currency using the platform formatter.
// The correct field is chosen by currency; the two are never converted.
// Intl.NumberFormat handles the symbol, decimals, and digit grouping (e.g.
// ₹1,999.00 with Indian grouping, $39.99) so no string is built by hand.
function formatPrice(course: Course, currency: Currency): string {
    if (currency === "INR") {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
        }).format(course.pricePaise / 100)
    }
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(course.priceUsdCents / 100)
}

// Sort options exposed by the toolbar. "recommended" preserves the API's order.
type SortOption = "recommended" | "price-asc" | "price-desc"

// Case-insensitive filter across the three learner-facing text fields. Returns
// a NEW array (never mutates the source); an empty query returns all courses.
function filterCourses(courses: Course[], query: string): Course[] {
    const q = query.trim().toLowerCase()
    if (q === "") return courses
    return courses.filter(
        (course) =>
            course.courseName.toLowerCase().includes(q) ||
            course.description.toLowerCase().includes(q) ||
            course.mainCategory.toLowerCase().includes(q)
    )
}

// The price to sort by, chosen by the active currency (the two are never
// converted). Returns null when there is no currency yet or the value isn't a
// usable number, so those courses can be pushed to the end without breaking.
function priceValue(course: Course, currency: Currency | null): number | null {
    if (currency === null) return null
    const raw = currency === "INR" ? course.pricePaise : course.priceUsdCents
    return Number.isFinite(raw) ? raw : null
}

// Returns a NEW sorted array (source untouched). "recommended" keeps API order;
// price sorts push unavailable prices to the end in either direction.
function sortCourses(
    courses: Course[],
    sortOption: SortOption,
    currency: Currency | null
): Course[] {
    if (sortOption === "recommended") return courses
    const direction = sortOption === "price-asc" ? 1 : -1
    return [...courses].sort((a, b) => {
        const pa = priceValue(a, currency)
        const pb = priceValue(b, currency)
        if (pa === null && pb === null) return 0
        if (pa === null) return 1
        if (pb === null) return -1
        return (pa - pb) * direction
    })
}

// Soft focus ring in the accent color. Falls back to a neutral ring if the
// accent isn't a 6-digit hex (Framer's Color control can return rgba()).
function focusRing(accent: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(accent)
        ? `0 0 0 3px ${accent}22`
        : "0 0 0 3px rgba(15, 23, 42, 0.08)"
}

// ---------------------------------------------------------------------------
// Component props — driven entirely by the Framer property controls below.
// ---------------------------------------------------------------------------
interface CourseSectionProps {
    accentColor: string
    heading: string
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight auto
 */
export default function CourseSection(props: CourseSectionProps) {
    const { accentColor, heading } = props

    // Two independent state slices. Courses is the critical dependency;
    // country is best-effort and only decides currency. Both start loading.
    const [coursesState, setCoursesState] = useState<CoursesState>({
        status: "loading",
    })
    const [countryState, setCountryState] = useState<CountryState>({
        status: "loading",
    })

    // Reload counters: bumping one re-runs only that request's effect, which is
    // how each Retry action refetches independently without a page reload.
    const [coursesReload, setCoursesReload] = useState(0)
    const [countryReload, setCountryReload] = useState(0)

    // Client-side view controls — operate only on the already-fetched courses,
    // never trigger a request, and never mutate the source array.
    const [searchQuery, setSearchQuery] = useState("")
    const [sortOption, setSortOption] = useState<SortOption>("recommended")
    const [searchFocused, setSearchFocused] = useState(false)

    // Courses request — decides whether there is a grid at all.
    useEffect(() => {
        const controller = new AbortController()
        setCoursesState({ status: "loading" })

        async function loadCourses() {
            try {
                const data = await fetchJson(COURSES_ENDPOINT, controller.signal)
                if (controller.signal.aborted) return
                // A failed request can return a JSON object instead of an array;
                // validate before treating it as Course[].
                if (!Array.isArray(data)) {
                    setCoursesState({ status: "error" })
                    return
                }
                if (data.length === 0) {
                    setCoursesState({ status: "empty" })
                    return
                }
                setCoursesState({ status: "ready", courses: data as Course[] })
            } catch {
                if (controller.signal.aborted) return
                setCoursesState({ status: "error" })
            }
        }

        loadCourses()
        return () => controller.abort()
    }, [coursesReload])

    // Country request — only decides currency. Never touches course state.
    useEffect(() => {
        const controller = new AbortController()
        setCountryState({ status: "loading" })

        async function loadCountry() {
            try {
                const data = await fetchJson(COUNTRY_ENDPOINT, controller.signal)
                if (controller.signal.aborted) return
                const currency = toCurrency(data)
                if (currency === null) {
                    setCountryState({ status: "error" })
                    return
                }
                setCountryState({ status: "ready", currency })
            } catch {
                if (controller.signal.aborted) return
                setCountryState({ status: "error" })
            }
        }

        loadCountry()
        return () => controller.abort()
    }, [countryReload])

    const retryCourses = () => setCoursesReload((n) => n + 1)
    const retryCountry = () => setCountryReload((n) => n + 1)

    // Search + sort toolbar. Rendered only inside the ready state (below), so it
    // never overlays or interferes with the loading / error / empty UIs.
    function renderToolbar() {
        return (
            <div className={TOOLBAR_CLASS}>
                <div className={SEARCH_CLASS}>
                    <svg
                        style={styles.searchIcon}
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#98A2B3"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <circle cx="11" cy="11" r="7" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setSearchFocused(false)}
                        placeholder="Search courses..."
                        aria-label="Search courses"
                        style={{
                            ...styles.searchInput,
                            borderColor: searchFocused ? accentColor : "#EAECF0",
                            boxShadow: searchFocused ? focusRing(accentColor) : "none",
                        }}
                    />
                </div>
                <select
                    className={SORT_CLASS}
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value as SortOption)}
                    aria-label="Sort courses by price"
                    style={styles.sortSelect}
                >
                    <option value="recommended">Recommended</option>
                    <option value="price-asc">Price: Low to High</option>
                    <option value="price-desc">Price: High to Low</option>
                </select>
            </div>
        )
    }

    // Body is chosen by the CRITICAL course state. Country state only matters
    // once courses are ready (it affects the price area inside each card).
    function renderBody() {
        switch (coursesState.status) {
            case "loading":
                return (
                    <div className={GRID_CLASS} aria-busy="true">
                        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                            <SkeletonCard key={i} />
                        ))}
                    </div>
                )

            case "error":
                return (
                    <div style={styles.stateBlock} role="alert">
                        <p style={styles.stateTitle}>
                            We couldn’t load the courses.
                        </p>
                        <p style={styles.stateText}>
                            Please check your connection and try again.
                        </p>
                        <button
                            type="button"
                            onClick={retryCourses}
                            style={{ ...styles.button, backgroundColor: accentColor }}
                        >
                            Retry Courses
                        </button>
                    </div>
                )

            case "empty":
                return (
                    <div style={styles.stateBlock}>
                        <p style={styles.stateTitle}>No courses available yet.</p>
                        <p style={styles.stateText}>
                            Please check back soon — new courses are on the way.
                        </p>
                    </div>
                )

            case "ready": {
                // Derived, non-mutating view of the already-fetched courses.
                const currency =
                    countryState.status === "ready" ? countryState.currency : null
                const filtered = filterCourses(coursesState.courses, searchQuery)
                const visible = sortCourses(filtered, sortOption, currency)

                return (
                    <>
                        {renderToolbar()}
                        {countryState.status === "error" && visible.length > 0 && (
                            <div style={styles.banner} role="status">
                                <span style={styles.bannerText}>
                                    Prices temporarily unavailable
                                </span>
                                <button
                                    type="button"
                                    onClick={retryCountry}
                                    style={styles.bannerButton}
                                >
                                    Retry Prices
                                </button>
                            </div>
                        )}
                        {visible.length === 0 ? (
                            // Search produced no matches — distinct from the API
                            // "empty" state (which means the API returned zero).
                            <div style={styles.stateBlock}>
                                <p style={styles.stateTitle}>No courses found</p>
                                <p style={styles.stateText}>Try a different search.</p>
                            </div>
                        ) : (
                            <div className={GRID_CLASS}>
                                {visible.map((course) => (
                                    <CourseCard
                                        key={course.mangoId}
                                        course={course}
                                        countryState={countryState}
                                        accentColor={accentColor}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )
            }
        }
    }

    return (
        <section className={SECTION_CLASS} style={styles.section}>
            {/* Grid, responsive padding, card skin + hover (can't be inline) */}
            <style>{GRID_CSS + COMPONENT_CSS}</style>

            {/* Section header — driven by the `heading` and `accentColor` controls */}
            <header style={styles.header}>
                <h2 style={styles.heading}>{heading}</h2>
                <div style={{ ...styles.accentBar, backgroundColor: accentColor }} />
            </header>

            <div style={styles.content}>{renderBody()}</div>
        </section>
    )
}

// ---------------------------------------------------------------------------
// CourseCard — one course. Price area depends on the best-effort country state.
// ---------------------------------------------------------------------------
interface CourseCardProps {
    course: Course
    countryState: CountryState
    accentColor: string
}

function CourseCard({ course, countryState, accentColor }: CourseCardProps) {
    // The price area reflects the country slice: loading → skeleton,
    // error → "Price unavailable" (never a defaulted currency), ready → format.
    function renderPrice() {
        if (countryState.status === "loading") {
            return <span style={styles.priceSkeleton} aria-hidden="true" />
        }
        if (countryState.status === "error") {
            return <span style={styles.priceUnavailable}>Price unavailable</span>
        }
        return (
            <span style={styles.price}>
                {formatPrice(course, countryState.currency)}
            </span>
        )
    }

    return (
        <article
            className={`${CARD_BASE_CLASS} ${CARD_HOVER_CLASS}`}
            style={styles.card}
        >
            <div style={styles.cardTop}>
                <span style={{ ...styles.category, color: accentColor }}>
                    {course.mainCategory}
                </span>
                {course.refundable && (
                    <span style={styles.badge}>Refundable</span>
                )}
            </div>
            <h3 style={styles.courseName}>{course.courseName}</h3>
            {/* Two-line clamp is CSS-only (see styles.description); the full
                string is passed through untouched. */}
            <p style={styles.description}>{course.description}</p>
            <div style={styles.cardFooter}>
                {/* courseType: one extra API field, kept clearly secondary */}
                <span style={styles.courseType}>{course.courseType}</span>
                {renderPrice()}
            </div>
        </article>
    )
}

// ---------------------------------------------------------------------------
// SkeletonCard — a static placeholder that mirrors the CourseCard layout so
// the loading state communicates the eventual structure (no animation).
// ---------------------------------------------------------------------------
function SkeletonCard() {
    return (
        <article className={CARD_BASE_CLASS} style={styles.card} aria-hidden="true">
            <div style={styles.cardTop}>
                <span style={{ ...styles.skeleton, width: 84, height: 12 }} />
                <span
                    style={{ ...styles.skeleton, width: 64, height: 20, borderRadius: 999 }}
                />
            </div>
            <span
                style={{ ...styles.skeleton, width: "75%", height: 18, marginBottom: 12 }}
            />
            <span
                style={{ ...styles.skeleton, width: "100%", height: 12, marginBottom: 8 }}
            />
            <span style={{ ...styles.skeleton, width: "88%", height: 12 }} />
            <div style={styles.cardFooter}>
                <span style={{ ...styles.skeleton, width: 56, height: 14 }} />
                <span style={{ ...styles.skeleton, width: 88, height: 22 }} />
            </div>
        </article>
    )
}

// ---------------------------------------------------------------------------
// Styles — inline objects (Framer idiom, no external CSS).
// The responsive grid itself lives in GRID_CSS above (media queries can't be
// expressed as inline styles); everything else is inline.
// ---------------------------------------------------------------------------
const styles: Record<string, CSSProperties> = {
    // Padding is applied responsively via SECTION_CLASS in COMPONENT_CSS.
    section: {
        width: "100%",
        boxSizing: "border-box",
        fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#0F172A",
        backgroundColor: "#FFFFFF",
    },
    header: {
        maxWidth: 1200,
        margin: "0 auto 40px",
    },
    heading: {
        margin: 0,
        // Fluid size keeps the hierarchy strong on desktop and calm on mobile.
        fontSize: "clamp(26px, 3.4vw, 36px)",
        fontWeight: 720,
        letterSpacing: -0.5,
        lineHeight: 1.15,
        color: "#0F172A",
    },
    accentBar: {
        marginTop: 14,
        width: 44,
        height: 4,
        borderRadius: 999,
    },
    content: {
        maxWidth: 1200,
        margin: "0 auto",
    },
    // Toolbar controls — same border/radius/typography language as the cards.
    searchInput: {
        width: "100%",
        boxSizing: "border-box",
        padding: "11px 14px 11px 38px", // left room for the search icon
        fontSize: 14,
        fontFamily: "inherit",
        color: "#101828",
        backgroundColor: "#FFFFFF",
        border: "1px solid #EAECF0", // borderColor overridden inline on focus
        borderRadius: 12,
        outline: "none",
        transition: "border-color 140ms ease, box-shadow 140ms ease",
    },
    searchIcon: {
        position: "absolute",
        left: 13,
        top: "50%",
        transform: "translateY(-50%)",
        pointerEvents: "none",
    },
    sortSelect: {
        boxSizing: "border-box",
        padding: "11px 14px",
        fontSize: 14,
        fontFamily: "inherit",
        color: "#101828",
        backgroundColor: "#FFFFFF",
        border: "1px solid #EAECF0",
        borderRadius: 12,
        cursor: "pointer",
        outline: "none",
    },
    // Card — layout only. The visual skin (padding/border/radius/shadow) and the
    // hover live in COMPONENT_CSS via CARD_BASE_CLASS / CARD_HOVER_CLASS.
    card: {
        display: "flex",
        flexDirection: "column",
        height: "100%", // fill the stretched grid cell → equal heights per row
        boxSizing: "border-box",
    },
    cardTop: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 14,
        minHeight: 22,
    },
    category: {
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    badge: {
        fontSize: 11,
        fontWeight: 600,
        color: "#067647",
        backgroundColor: "#ECFDF3",
        border: "1px solid #ABEFC6",
        padding: "2px 8px",
        borderRadius: 999,
        letterSpacing: 0.2,
        whiteSpace: "nowrap",
    },
    courseName: {
        margin: "0 0 8px",
        fontSize: 18,
        fontWeight: 680,
        lineHeight: 1.35,
        letterSpacing: -0.2,
        color: "#101828",
        overflowWrap: "break-word", // guard against long unbroken tokens
    },
    description: {
        margin: 0,
        fontSize: 14,
        lineHeight: 1.55,
        color: "#475467",
        overflowWrap: "break-word",
        // CSS two-line clamp — the string itself is never truncated in JS.
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        overflow: "hidden",
    },
    cardFooter: {
        marginTop: "auto", // pins the price row to the bottom of every card
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        paddingTop: 16,
        borderTop: "1px solid #F2F4F7",
    },
    courseType: {
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: "#667085", // clearly secondary to the price
        whiteSpace: "nowrap",
    },
    price: {
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: -0.2,
        color: "#101828",
        fontVariantNumeric: "tabular-nums",
    },
    priceUnavailable: {
        fontSize: 13,
        fontWeight: 500,
        fontStyle: "italic",
        color: "#98A2B3",
    },
    priceSkeleton: {
        display: "inline-block",
        width: 84,
        height: 20,
        borderRadius: 6,
        backgroundColor: "#EAECF0",
    },

    // Skeleton block (loading)
    skeleton: {
        display: "inline-block",
        borderRadius: 6,
        backgroundColor: "#EAECF0",
    },

    // Course error / empty blocks
    stateBlock: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 8,
        padding: "64px 24px",
        border: "1px solid #EAECF0",
        borderRadius: 16,
        backgroundColor: "#FCFCFD",
    },
    stateTitle: {
        margin: 0,
        fontSize: 18,
        fontWeight: 680,
        color: "#101828",
    },
    stateText: {
        margin: 0,
        maxWidth: 360,
        fontSize: 14,
        lineHeight: 1.5,
        color: "#667085",
    },
    button: {
        marginTop: 16,
        padding: "11px 22px",
        border: "none",
        borderRadius: 10,
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
    },

    // Country-error price banner
    banner: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 24,
        padding: "12px 16px",
        borderRadius: 12,
        border: "1px solid #FEDF89",
        backgroundColor: "#FFFAEB",
    },
    bannerText: {
        fontSize: 14,
        fontWeight: 600,
        color: "#B54708",
    },
    bannerButton: {
        padding: "7px 14px",
        border: "1px solid #FEC84B",
        borderRadius: 8,
        backgroundColor: "#FFFFFF",
        color: "#B54708",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
    },
}

// ---------------------------------------------------------------------------
// Framer property controls.
// Two designer-facing controls, both wired to the render above.
// ---------------------------------------------------------------------------
addPropertyControls(CourseSection, {
    accentColor: {
        type: ControlType.Color,
        title: "Accent Color",
        defaultValue: "#4F46E5",
    },
    heading: {
        type: ControlType.String,
        title: "Section Heading",
        defaultValue: "Explore Our Courses",
        placeholder: "Section heading…",
    },
})
