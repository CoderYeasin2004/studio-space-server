# StudioSpace Backend

StudioSpace is a studio booking platform backend built with Node.js, Express.js, and MongoDB. It provides REST APIs for studio management, booking management, availability, authentication, and reviews.

# Backend Live server :- studio-space-backend-swart.vercel.app

## Technologies Used

- Node.js
- Express.js 5
- MongoDB
- JWT Authentication
- JOSE
- CORS
- dotenv

## Features

- JWT-based authentication and protected API routes
- Create, update, delete, and retrieve studio listings
- Studio availability management
- Customer studio booking
- Host booking management
- Booking status management
- Review submission and eligibility checking
- Studio ratings and review counts
- Platform statistics

## Installation

### 1. Clone the Repository

bash
git clone YOUR_BACKEND_REPOSITORY_URL
cd studio-space-server


### 2. Install Dependencies

bash
npm install


### 3. Environment Variables

Create a .env file in the project root:

env
PORT=5000
MONGO_URI=your_mongodb_connection_string
CLIENT_URL=http://localhost:3000

For production, set CLIENT_URL to your deployed frontend URL.

**Important:** Never share or commit your .env file or MongoDB credentials.

### 4. Run the Server

node index.js

The backend will run at:

http://localhost:5000

## API Endpoints

### General

| Method | Endpoint | Description |
| GET |  | Server health check |

### Studios

| Method | Endpoint | Description |
| POST | /studios | Create a studio |
| GET | /studios | Get all live studios |
| GET | /studios/:slug | Get studio details |
| GET | /my-studios/:email | Get studios owned by a user |
| PATCH | /studios/:id | Update a studio |
| DELETE | /studios/:id | Delete a studio |
| GET | /studios/hero | Get the featured studio |
| GET | /stats/categories | Get studio counts by category |
| GET | /stats | Get platform statistics |

### Bookings

| Method | Endpoint | Description |
|---|---|---|
| POST | /studios/booking | Create a booking |
| GET | /my-studio-bookings/:email | Get customer and Host bookings |
| GET | /studios/:id/availability | Get booked dates |
| PATCH | /studios/booking/:id/confirm | Confirm a pending booking |
| PATCH | /studios/booking/:id/complete | Mark a booking as completed |
| DELETE | /studios/booking/:id | Delete a customer's booking |

### Reviews

| Method | Endpoint | Description |
| POST | /studios/:id/reviews | Submit a review |
| GET | /studios/:id/reviews | Get studio reviews |
| GET | /studios/:id/review-eligibility | Check review eligibility |

## Booking Status

New bookings are automatically created with `pending` status.

Supported booking status values in the application:

pending
confirmed
cancelled
completed

Hosts can confirm pending bookings and mark confirmed bookings as completed.

## Authentication

Protected routes use JWT authentication.

The backend verifies tokens using the JSON Web Key Set (JWKS) endpoint provided by the frontend authentication system:


CLIENT_URL/api/auth/jwks


Send the token through the Authorization header:


Authorization: Bearer YOUR_ACCESS_TOKEN


Customer identity is obtained from the verified JWT payload.

## Database

MongoDB database name:


studio-space-server


Collections:

studios
bookings
reviews

## Deployment

The backend is deployed on Vercel.

Production API:

https://studio-space-backend-swart.vercel.app/

## Security

- JWT verification for protected routes
- Authenticated customer identity
- Host ownership verification for booking status updates
- Environment-based configuration
- CORS configuration
