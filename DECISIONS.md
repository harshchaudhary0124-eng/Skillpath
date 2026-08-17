# Skillpath — Engineering Decisions

## API verification

The live API was verified before implementation using GET requests only.

### Course endpoint
- 12 requests tested
- 8 successful responses
- 2 × 404
- 2 × 500
- Successful responses were JSON arrays
- Successful course counts ranged from 5 to 10
- Failure responses were JSON error objects

### Country endpoint
- 12 requests tested
- 8 successful responses
- 4 × 404
- Successful responses returned either IN or US
- Both country values were observed
- Failure responses were JSON error objects

## Decisions

### 1. Independent API state
Course and country requests are modeled independently because they
have different consequences when they fail.

### 2. Course API is critical
Without course data, there is no course catalog to render.

### 3. Country API is best-effort
The country endpoint determines which existing price field should
be displayed. It does not determine whether the course grid exists.

### 4. Country failure
If courses load but country detection fails, courses remain visible.
The component does not guess a currency. Prices temporarily display
as unavailable and the country request can be retried independently.

### 5. Price conversion
IN → pricePaise / 100
US → priceUsdCents / 100

The two monetary fields are never converted against each other.

### 6. Extra course field
mainCategory is shown because it provides useful information to a
learner about what the course is about.

### 7. Responsive grid
The course count is dynamic, so the layout does not depend on a
fixed number of cards.

### 8. Property controls
Accent Color and Section Heading are exposed because both are
meaningful designer-facing properties.

### 9. Minimal architecture
The implementation intentionally avoids unnecessary libraries and
abstractions so the code remains readable and explainable.

### 10. React key
mangoId is the React key because it represents the course's stable
entity identity and is more appropriate than a human-readable
business/slug field.