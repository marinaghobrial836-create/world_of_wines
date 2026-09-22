# World of Wines

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000.

There is no login or account requirement. Anyone who can reach the deployed site can browse the catalog and place an order. The server listens on `0.0.0.0` so it works with public hosts and forwarded ports.

## Publish the site

The simplest public deployment is Render:

1. Push this project to a GitHub repository.
2. Create a new **Web Service** at [render.com](https://render.com) and select the repository.
3. Use `npm install` as the build command and `npm start` as the start command.
4. Add the SMTP and optional Twilio environment variables below in Render's Environment settings.
5. Deploy. Render will provide a public `onrender.com` URL that anyone can open without logging in.

Keep the checkout email field because it is needed to send the customer's order confirmation; it is not used for site access or authentication.

## Order confirmation email

Checkout asks whether the customer wants Delivery or Pickup, then sends a detailed confirmation to `worldofwines1@gmail.com` and the customer's checkout email address. Both emails include the confirmation number, customer details, fulfillment choice, product names, quantities, per-item costs, and total cost. The customer's phone number is included in the emails.

Configure SMTP before placing real orders. For Gmail, enable 2-Step Verification on `worldofwines1@gmail.com`, create a Google app password, and set these environment variables when starting the server:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=worldofwines1@gmail.com
export SMTP_PASS='your-16-character-google-app-password'
export SMTP_FROM=worldofwines1@gmail.com
npm start
```

To send the same confirmation by SMS to the customer's phone, configure a Twilio phone number too:

```bash
export TWILIO_ACCOUNT_SID=your-account-sid
export TWILIO_AUTH_TOKEN=your-auth-token
export TWILIO_FROM_NUMBER='+15551234567'
```

SMS is skipped until these Twilio variables are configured; email confirmations still send normally.

Never commit the app password or put it in browser code. Without these variables, the checkout keeps the cart and reports that the confirmation could not be sent.