# Google reviews feature

## Design

Reviews sit between the existing brand introduction and the flower collection. Warm paper tones and the site's serif typography make this a featured customer story rather than a scrolling ad ticker. One readable card, an honest Google source label, previous/next controls and a pause button keep the experience simple on desktop and mobile.

Auto-rotation runs only when the carousel is visible, with at least nine seconds per review. Hover pauses temporarily; keyboard focus, manual navigation and expanding text pause until Play is selected. Reduced-motion visitors start paused. Offscreen cards are inert. The grid reserves the tallest card's space to avoid shifting the page. Without JavaScript both existing attributed excerpts remain readable.

## Source and refresh

The independent `reviews-worker` reads the owner's Google Business Profile API, never scraping Google Maps. It requests the 50 most recently updated reviews without a rating filter. Google supplies the overall rating/count; the site never calculates them from a selected sample. Full text and reviewer names are preserved. Long text can be expanded. Rating-only reviews are explicitly labeled. API reviews link to the business's Google reviews, not a fabricated individual permalink.

Only the public display fields are returned. OAuth secrets stay in Worker secrets. Edge caching lasts one hour; there is no review archive committed to Git. An open page checks every five minutes, with updates deferred while a visitor interacts. Updates normally appear within about 65 minutes of Google's API exposing them. Failed/invalid initial requests retain the original attributed Moments excerpts, with no false live rating or count. A previously loaded feed stays usable during brief outages and expires after a day when the visitor is not interacting. Those original excerpts predate the API and retain their source/service labels.

## Activation (required before claiming automatic updates are live)

1. Obtain Business Profile API access for the business-owned Google Cloud project and authorize a Google account that manages the verified Williamson Wallflowers location, using scope `https://www.googleapis.com/auth/business.manage` and offline access. A normal Google sign-in or a Places API key is not sufficient. Production OAuth configuration must support a durable refresh token; testing-mode tokens may expire.
2. From `reviews-worker`, securely set Wrangler secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Do not paste credentials into the website, Git, or chat. Set `GOOGLE_LOCATION_NAME` to the verified `accounts/ACCOUNT_ID/locations/LOCATION_ID` in Wrangler vars. Confirm the location is Williamson Wallflowers, not another business on the account.
3. Authenticate Wrangler to the correct Cloudflare account, run `npm install` and `npm run deploy`. This is a separate Worker and does not replace the existing inquiry/Moments service. No additional storage resource or third-party widget subscription is required.
4. Verify `GET /reviews` returns actual Williamson Wallflowers authors/text, a current `fetchedAt`, and Google's rating/count. Verify allowed website origins receive CORS headers.
5. Set `data-reviews-endpoint` on `#reviews` in `index.html` to the verified deployed HTTPS `/reviews` URL. It is deliberately empty until the source is connected; the current carousel uses the two existing Google excerpts.
6. Test on the site, including a fresh API response and an unavailable source. Check Worker logs after authorization changes. Do not advertise the integration as connected until a real response has been verified.

Validation: `node --test reviews-worker/tests/*.test.js`, `node --check assets/reviews.js`, desktop/mobile browser checks. For an outage, Google permissions changes or invalid credentials, existing content remains available; repair the owner connection and verify a new response rather than fabricating fresh reviews.

References: https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list and https://developers.google.com/my-business/content/policies
