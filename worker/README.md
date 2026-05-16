# Williamson Wallflowers Inquiry Worker

This Cloudflare Worker receives the Williamson Wallflowers inquiry form, sends the inquiry to Jami, and sends a confirmation email to the applicant.

## Setup

1. Verify `jjentertainmentsolutions.com` in Resend.
2. Create a Resend API key with sending permission.
3. Install and deploy:

   ```bash
   cd worker
   npm install
   npx wrangler secret put resend
   npx wrangler deploy
   ```

4. After deploy, Wrangler should print:

   ```text
   https://williamson-wallflowers-inquiry.johnmartinferguson.workers.dev
   ```

The site form currently points at that `workers.dev` endpoint. The static site can remain on GitHub Pages.

The Worker sends with the display name `Williamson Wallflowers` from the verified JJE sender domain:

```text
Williamson Wallflowers <noreply@jjentertainmentsolutions.com>
```
