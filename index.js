import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PORT = process.env.PORT || 5000;

const app = express();
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  }),
);
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Server Is running File!");
});

const client = new MongoClient(process.env.MONGO_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectClient = await connectToMongoDB();
const db = connectClient.db("studio-space-server");
const studiosCollection = db.collection("studios");
const studioBookingCollection = db.collection("bookings");
const reviewsCollection = db.collection("reviews");

// middleware

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({ msg: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
  );

  try {
    const { payload } = await jwtVerify(token, JWKS);

    console.log("Verified JWT Payload:", payload);

    req.user = payload;

    next();
  } catch (error) {
    console.error("JWT verification failed:", error.message);

    return res.status(401).send({ msg: "Token not verified" });
  }
};

// Create a new studio
app.post("/studios", verifyToken, async (req, res) => {
  const creatorEmail = req.user?.email;
  const creatorId = req.user?.id;

  const result = await studiosCollection.insertOne({
    ...req.body,
    creatorEmail,
    creatorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  res.send(result);
});

// Submit a review for a completed studio booking

app.post("/studios/:id/reviews", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { bookingId, rating, text } = req.body;
    const email = req.user?.email;
    const author = req.user?.name || email;

    if (
      !ObjectId.isValid(id) ||
      !ObjectId.isValid(bookingId) ||
      !email ||
      !author?.trim() ||
      !Number.isInteger(Number(rating)) ||
      Number(rating) < 1 ||
      Number(rating) > 5 ||
      !text?.trim()
    ) {
      return res.status(400).send({ message: "Invalid review" });
    }

    const booking = await studioBookingCollection.findOne({
      _id: new ObjectId(bookingId),
      studioId: id,
      customerEmail: email,
      status: "completed",
      reviewSubmitted: { $ne: true },
    });

    if (!booking) {
      return res.status(404).send({
        message: "No eligible booking found or already reviewed",
      });
    }

    const result = await studioBookingCollection.updateOne(
      {
        _id: new ObjectId(bookingId),
        customerEmail: email,
        status: "completed",
        reviewSubmitted: { $ne: true },
      },
      {
        $set: { reviewSubmitted: true },
      },
    );

    if (result.modifiedCount !== 1) {
      return res.status(400).send({ message: "Booking already reviewed" });
    }

    const review = {
      studioId: new ObjectId(id),
      bookingId: new ObjectId(bookingId),
      author: author.trim(),
      role: "Customer",
      avatar: "",
      rating: Number(rating),
      date: new Date(),
      text: text.trim(),
      createdAt: new Date(),
    };

    const inserted = await reviewsCollection.insertOne(review);

    const reviews = await reviewsCollection
      .find({ studioId: new ObjectId(id) })
      .toArray();

    const averageRating = Number(
      (
        reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length
      ).toFixed(1),
    );

    await studiosCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          rating: averageRating,
          reviewCount: reviews.length,
        },
      },
    );

    res.status(201).send({
      message: "Review submitted successfully",
      review: {
        id: inserted.insertedId.toString(),
        author: review.author,
        role: review.role,
        avatar: review.avatar,
        rating: review.rating,
        date: review.date,
        text: review.text,
      },
    });
  } catch (error) {
    console.error("Review submission error:", error);
    res.status(500).send({ message: "Server error" });
  }
});

// Check review eligibility based on a completed booking

app.get("/studios/:id/review-eligibility", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.user?.email?.trim().toLowerCase();

    if (!ObjectId.isValid(id) || !email) {
      return res.status(400).send({ eligible: false });
    }

    const booking = await studioBookingCollection.findOne({
      studioId: id,
      customerEmail: email,
      status: "completed",
      reviewSubmitted: { $ne: true },
    });

    res.status(200).send({
      canReview: !!booking,
      bookingId: booking?._id.toString() || null,
    });
  } catch (error) {
    res.status(500).send({ message: "Server error" });
  }
});

// Get studios owned by a user email
app.get("/my-studios/:email", verifyToken, async (req, res) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(401).send({ message: "Authentication required" });
  }

  const result = await studiosCollection
    .find({ creatorEmail: email })
    .toArray();

  res.send(
    result.map((studio) => ({
      ...studio,
      id: studio._id.toString(),
    })),
  );
});

// Get bookings for studios owned by a user email
app.get("/my-studio-bookings/:email", verifyToken, async (req, res) => {
  const email = req.user?.email;

  if (!email) {
    return res.status(401).send({ message: "Authentication required" });
  }

  const studios = await studiosCollection
    .find({ creatorEmail: email })
    .project({ _id: 1, slug: 1 })
    .toArray();

  const studioIds = studios.map((studio) => studio._id.toString());
  const studioSlugs = studios.map((studio) => studio.slug).filter(Boolean);

  const bookings = await studioBookingCollection
    .find({
      $or: [
        { studioId: { $in: studioIds } },
        { studioSlug: { $in: studioSlugs } },
      ],
    })
    .toArray();

  res.send(
    bookings.map(({ _id, ...booking }) => ({
      ...booking,
      id: _id.toString(),
    })),
  );
});

// Delete a studio booking by ID
app.delete("/studios/booking/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({ message: "Invalid booking ID" });
  }

  const booking = await studioBookingCollection.findOne({
    _id: new ObjectId(id),
  });

  if (!booking) {
    return res.send({ message: "Booking not found" });
  }

  if (booking.customerEmail !== req.user?.email) {
    return res
      .status(403)
      .send({ message: "Forbidden: You do not own this booking" });
  }

  const result = await studioBookingCollection.deleteOne({
    _id: new ObjectId(id),
  });

  if (!result.deletedCount) {
    return res.send({ message: "Booking not found" });
  }

  res.send(result);
});

// Confirm a pending studio booking
app.patch("/studios/booking/:id/confirm", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({ message: "Invalid ID" });
  }

  const booking = await studioBookingCollection.findOne({
    _id: new ObjectId(id),
  });

  if (!booking) {
    return res.send({ message: "Booking not found" });
  }

  const studio = await studiosCollection.findOne({
    _id: new ObjectId(booking.studioId),
  });

  if (!studio || studio.creatorEmail !== req.user?.email) {
    return res
      .status(403)
      .send({ message: "Forbidden: You do not own this studio" });
  }

  const result = await studioBookingCollection.updateOne(
    { _id: new ObjectId(id), status: "pending" },
    {
      $set: {
        status: "confirmed",
        confirmedAt: new Date(),
      },
    },
  );

  if (!result.matchedCount) {
    return res.send({ message: "Booking not found" });
  }

  res.send(result);
});

// Get all studio bookings
// app.get("/studios/booking", async (req, res) => {
//   const bookings = await studioBookingCollection.find({}).toArray();

//   res.send(
//     bookings.map(({ _id, ...booking }) => ({
//       ...booking,
//       id: _id.toString(),
//     }))
//   );
// });

// Update a studio by ID
app.patch("/studios/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({ message: "Invalid ID" });
  }

  const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });

  if (!studio) {
    return res.status(404).send({ message: "Studio not found" });
  }

  if (studio.creatorEmail !== req.user?.email) {
    return res
      .status(403)
      .send({ message: "Forbidden: You do not own this studio" });
  }

  const result = await studiosCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...req.body,
        updatedAt: new Date(),
      },
    },
  );

  res.send(result);
});

// Delete a studio by ID (permanent delete)
app.delete("/studios/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({
      message: "Invalid studio ID",
    });
  }

  const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });

  if (!studio) {
    return res.status(404).send({ message: "Studio not found" });
  }

  if (studio.creatorEmail !== req.user?.email) {
    return res
      .status(403)
      .send({ message: "Forbidden: You do not own this studio" });
  }

  const result = await studiosCollection.deleteOne({
    _id: new ObjectId(id),
  });

  res.send({
    acknowledged: result.acknowledged,
    deletedCount: result.deletedCount,
  });
});

// Create a new studio booking

app.post("/studios/booking", verifyToken, async (req, res) => {
  const { studioId, date, startTime, endTime } = req.body;

  const email = req.user?.email;

  if (
    !ObjectId.isValid(studioId) ||
    !date ||
    !email ||
    !startTime ||
    !endTime ||
    !/^\d{2}:\d{2}$/.test(startTime) ||
    !/^\d{2}:\d{2}$/.test(endTime) ||
    startTime >= endTime
  ) {
    return res.status(400).send({
      message: "Invalid booking details",
    });
  }

  const session = client.startSession();

  try {
    const result = await session.withTransaction(async () => {
      const lock = await studiosCollection.updateOne(
        {
          _id: new ObjectId(studioId),
          status: "live",
          isDeleted: { $ne: true },
        },
        { $inc: { bookingVersion: 1 } },
        { session },
      );

      if (!lock.matchedCount) return "STUDIO_NOT_FOUND";

      const existingBookings = await studioBookingCollection
        .find(
          {
            studioId,
            date,
            status: "confirmed",
          },
          { session },
        )
        .toArray();

      const hasOverlap = existingBookings.some((booking) => {
        return (
          startTime < booking.endTime &&
          endTime > booking.startTime
        );
      });

      if (hasOverlap) return "BOOKING_CONFLICT";

      await studioBookingCollection.insertOne(
        {
          ...req.body,
          customerEmail: email,
          reviewSubmitted: false,
          status: "pending",
          createdAt: new Date(),
        },
        { session },
      );

      return "SUCCESS";
    });

    if (result === "STUDIO_NOT_FOUND") {
      return res.status(404).send({
        message: "Studio not available",
      });
    }

    if (result === "BOOKING_CONFLICT") {
      return res.status(409).send({
        message: "This time slot is already booked",
      });
    }

    return res.send({
      message: "Booking successful",
    });
  } catch (error) {
    console.error("Booking creation error:", error);

    return res.status(500).send({
      message: "Failed to create booking",
    });
  } finally {
    await session.endSession();
  }
});


// Get booked dates for a studio
app.get("/studios/:id/availability", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({
      message: "Invalid studio ID",
    });
  }

  const studio = await studiosCollection.findOne({
    _id: new ObjectId(id),
    isDeleted: { $ne: true },
  });

  if (!studio) {
    return res.send([]);
  }

  const bookings = await studioBookingCollection
    .find({
      studioId: id,
      status: { $in: ["pending", "confirmed", "completed"] },
    })
    .project({
      _id: 0,
      date: 1,
    })
    .toArray();

  res.send(bookings);
});

// Mark a confirmed booking as completed
app.patch("/studios/booking/:id/complete", verifyToken, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({ message: "Invalid ID" });
  }

  const booking = await studioBookingCollection.findOne({
    _id: new ObjectId(id),
  });

  if (!booking) {
    return res.send({ message: "Booking not found" });
  }

  if (booking.status !== "confirmed") {
    return res.send({ message: "Booking is not confirmed" });
  }

  const studio = await studiosCollection.findOne({
    _id: new ObjectId(booking.studioId),
  });

  if (!studio || studio.creatorEmail !== req.user?.email) {
    return res
      .status(403)
      .send({ message: "Forbidden: You do not own this studio" });
  }

  const result = await studioBookingCollection.updateOne(
    { _id: new ObjectId(id), status: "confirmed" },
    {
      $set: {
        status: "completed",
        completedAt: new Date(),
      },
    },
  );

  if (!result.modifiedCount) {
    return res.send({ message: "Booking already processed" });
  }

  res.send({ message: "Booking completed successfully" });
});

// Get the top-rated hero studio
app.get("/studios/hero", async (req, res) => {
  const studio = await studiosCollection
    .find({
      status: "live",
      isDeleted: { $ne: true },
      rating: { $gte: 4.5 },
      reviewCount: { $gt: 0 },
    })
    .sort({
      reviewCount: -1,
      rating: -1,
      createdAt: -1,
    })
    .limit(1)
    .next();

  if (studio) {
    return res.send(studio);
  }

  const latestStudio = await studiosCollection
    .find({ status: "live", isDeleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();

  res.send(latestStudio || null);
});

// Get studio counts grouped by category
app.get("/stats/categories", async (req, res) => {
  const result = await studiosCollection
    .aggregate([
      { $match: { status: "live", isDeleted: { $ne: true } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ])
    .toArray();

  res.send(Object.fromEntries(result.map(({ _id, count }) => [_id, count])));
});

// Get reviews for a studio
app.get("/studios/:id/reviews", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) return res.send([]);

  const reviews = await reviewsCollection
    .find({ studioId: new ObjectId(id) })
    .sort({ createdAt: -1 })
    .toArray();

  res.send(
    reviews.map(({ _id, author, role, avatar, rating, date, text }) => ({
      id: _id.toString(),
      author,
      role,
      avatar,
      rating,
      date,
      text,
    })),
  );
});

// Get a studio by slug or ID
app.get("/studios/:slug", async (req, res) => {
  const { slug } = req.params;

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);

  const filter = isObjectId
    ? { _id: new ObjectId(slug), isDeleted: { $ne: true } }
    : { slug, isDeleted: { $ne: true } };

  const studio = await studiosCollection.findOne(filter);

  if (!studio) {
    return res.send({
      message: "Studio not found",
    });
  }

  res.send({
    ...studio,
    id: studio._id.toString(),
  });
});

// Get all live studios
app.get("/studios", async (req, res) => {
  const limitParam = req.query.limit;

  let limitValue = null;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return res.send({
        message: "Invalid limit parameter. Must be a positive integer.",
      });
    }
    limitValue = parsed;
  }

  let query = studiosCollection
    .find({ status: "live", isDeleted: { $ne: true } })
    .sort({
      rating: -1,
      reviewCount: -1,
      createdAt: -1,
    });

  if (limitValue !== null) {
    query = query.limit(limitValue);
  }

  const result = await query.toArray();

  res.send(result);
});

// Get overall platform statistics
app.get("/stats", async (req, res) => {
  const studios = await studiosCollection
    .find({ status: "live", isDeleted: { $ne: true } })
    .toArray();

  const cities = new Set(
    studios.map((studio) => studio.city?.trim().toLowerCase()).filter(Boolean),
  );

  const ratings = studios
    .map((studio) => studio.rating)
    .filter((rating) => typeof rating === "number");

  res.send({
    totalStudios: studios.length,
    totalCities: cities.size,
    averageRating: ratings.length
      ? Number(
          (
            ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
          ).toFixed(1),
        )
      : null,
  });
});

export async function disconnectFromMongoDB() {
  await client.close();
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app