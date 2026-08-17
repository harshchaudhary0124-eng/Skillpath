// Skillpath — Courses Section (Framer Code Component)
//
// STEP: scaffold only.
// The API fetching, CourseCard, and the loading/error/empty/ready UIs are
// added in later steps. This file establishes the structure and the two
// property controls so a designer can already drive the component.
//
// Architecture reference: see DECISIONS.md at the repo root.

import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import { addPropertyControls, ControlType } from "framer"

// ---------------------------------------------------------------------------
// API reference
// Verified live with GET-only requests before implementation (see DECISIONS.md).
// These are consumed by the fetch layer in the next step.
// ---------------------------------------------------------------------------
const API_BASE_URL = "https://syncsphere-hiv6.onrender.com"
const COURSES_ENDPOINT = `${API_BASE_URL}/assignment/course-data`
const COUNTRY_ENDPOINT = `${API_BASE_URL}/assignment/country-code`

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
// Fetch helpers
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

    useEffect(() => {
        const controller = new AbortController()

        // Courses request — decides whether there is a grid at all.
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

        // Country request — only decides currency. Never touches course state.
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

        // Fired without awaiting each other: neither request can cause or block
        // the other's outcome. This is why there is no single global state.
        loadCourses()
        loadCountry()

        return () => controller.abort()
    }, [])

    // TEMP developer-facing summaries — proves both independent states resolve.
    // Replaced by the real loading / error / empty UIs and the CourseCard grid
    // in the next step.
    const coursesSummary =
        coursesState.status === "ready"
            ? `${coursesState.courses.length} loaded`
            : coursesState.status
    const countrySummary =
        countryState.status === "ready"
            ? countryState.currency
            : countryState.status

    return (
        <section style={styles.section}>
            {/* Section header — driven by the `heading` and `accentColor` controls */}
            <header style={styles.header}>
                <h2 style={styles.heading}>{heading}</h2>
                <div style={{ ...styles.accentBar, backgroundColor: accentColor }} />
            </header>

            {/*
              Grid region.
              TODO(next): render one of four states here based on CoursesState +
              CountryState — loading (skeletons) / error (+retry) / empty / ready.
              When ready, map courses into <CourseCard /> inside this grid.
            */}
            <div style={styles.grid}>
                <p style={styles.placeholder}>
                    courses: {coursesSummary} · country: {countrySummary}
                </p>
            </div>
        </section>
    )
}

// ---------------------------------------------------------------------------
// Styles — inline objects (Framer idiom, no external CSS).
// The grid uses auto-fill + minmax so a dynamic course count (5–10) never
// leaves a broken row; exact 3/2/1 column tuning lands with the cards.
// ---------------------------------------------------------------------------
const styles: Record<string, CSSProperties> = {
    section: {
        width: "100%",
        boxSizing: "border-box",
        padding: "64px 24px",
        fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    header: {
        maxWidth: 1200,
        margin: "0 auto 32px",
    },
    heading: {
        margin: 0,
        fontSize: 32,
        fontWeight: 700,
        color: "#111111",
    },
    accentBar: {
        marginTop: 12,
        width: 56,
        height: 4,
        borderRadius: 2,
    },
    grid: {
        maxWidth: 1200,
        margin: "0 auto",
        display: "grid",
        gap: 24,
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    },
    placeholder: {
        gridColumn: "1 / -1",
        margin: 0,
        padding: "48px 0",
        textAlign: "center",
        color: "#888888",
        fontSize: 15,
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
