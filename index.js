import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'


const PORT = process.env.PORT || 5000;

const app = express()
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json())

// Health check endpoint
app.get("/",(req, res) =>  {
res.send("Hello World!")
})


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
const studioBookingCollection = db.collection("bookings")
const reviewsCollection = db.collection("reviews");

// Create a new studio
app.post("/studios", async (req, res) => {
  const result = await studiosCollection.insertOne({
    ...req.body,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  res.send(result);
});




// Submit a review for a completed studio booking
app.post("/studios/:id/reviews", async (req, res) => {
  const { id } = req.params;
  const { bookingId, author, rating, text } = req.body;

  if (
    !ObjectId.isValid(id) ||
    !ObjectId.isValid(bookingId) ||
    !author?.trim() ||
    !Number.isInteger(Number(rating)) ||
    Number(rating) < 1 ||
    Number(rating) > 5 ||
    !text?.trim()
  ) {
    return res.send({ message: "Invalid review" });
  }

  const booking = await studioBookingCollection.findOne({
    _id: new ObjectId(bookingId),
    studioId: id,
    status: "completed",
    reviewSubmitted: { $ne: true },
  });

  if (!booking) {
    return res.send({
      message: "No eligible booking found or already reviewed",
    });
  }

  const result = await studioBookingCollection.updateOne(
    {
      _id: new ObjectId(bookingId),
      status: "completed",
      reviewSubmitted: { $ne: true },
    },
    {
      $set: { reviewSubmitted: true },
    }
  );

  if (result.modifiedCount !== 1) {
    return res.send({ message: "Booking already reviewed" });
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
      reviews.reduce((sum, item) => sum + item.rating, 0) /
      reviews.length
    ).toFixed(1)
  );

  await studiosCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        rating: averageRating,
        reviewCount: reviews.length,
      },
    }
  );

  res.send({
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
});




// Check review eligibility based on a completed booking
app.get("/studios/:id/review-eligibility", async (req, res) => {
  const { id } = req.params;
  const email = req.query.email?.trim().toLowerCase();

  if (!ObjectId.isValid(id) || !email) {
    return res.send({ eligible: false });
  }

  const booking = await studioBookingCollection.findOne({
    studioId: id,
    customerEmail: email,
    status: "completed",
    reviewSubmitted: { $ne: true },
  });

  res.send({
    eligible: !!booking,
    bookingId: booking?._id.toString() || null,
  });
});


// Get studios owned by a user email
app.get("/my-studios/:email", async (req, res) => {
  const email = req.params.email;

  const result = await studiosCollection
    .find({ creatorEmail: email })
    .toArray();

  res.send(
    result.map((studio) => ({
      ...studio,
      id: studio._id.toString(),
    }))
  );
});

// Get bookings for studios owned by a user email
app.get("/my-studio-bookings/:email", async (req, res) => {
  const { email } = req.params;

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
    }))
  );
});

// Delete a studio booking by ID
app.delete("/studios/booking/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({ message: "Invalid booking ID" });
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
app.patch("/studios/booking/:id/confirm", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({ message: "Invalid ID" });
  }

  const result = await studioBookingCollection.updateOne(
    { _id: new ObjectId(id), status: "pending" },
    {
      $set: {
        status: "confirmed",
        confirmedAt: new Date(),
      },
    }
  );

  if (!result.matchedCount) {
    return res.send({ message: "Booking not found" });
  }

  res.send(result);
});




// Get all studio bookings
app.get("/studios/booking", async (req, res) => {
  const bookings = await studioBookingCollection.find({}).toArray();

  res.send(
    bookings.map(({ _id, ...booking }) => ({
      ...booking,
      id: _id.toString(),
    }))
  );
});

// Update a studio by ID
app.patch("/studios/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({ message: "Invalid ID" });
  }

  const result = await studiosCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...req.body,
        updatedAt: new Date(),
      },
    }
  );

  res.send(result);
});


// Delete a studio by ID
app.delete("/studios/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({
      message: "Invalid studio ID",
    });
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
app.post("/studios/booking", async (req, res) => {
  const { studioId, date, startTime, endTime, customerEmail } = req.body;

  const email = customerEmail?.trim().toLowerCase();
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (
    !ObjectId.isValid(studioId) ||
    !date ||
    !timePattern.test(startTime) ||
    !timePattern.test(endTime) ||
    startTime >= endTime ||
    !email
  ) {
    return res.send({ message: "Invalid booking details" });
  }

  const session = client.startSession();

  const result = await session
    .withTransaction(async () => {
      const lock = await studiosCollection.updateOne(
        { _id: new ObjectId(studioId), status: "live" },
        { $inc: { bookingVersion: 1 } },
        { session }
      );

      if (!lock.matchedCount) return "STUDIO_NOT_FOUND";

      const existing = await studioBookingCollection.findOne(
        {
          studioId,
          date,
          status: { $in: ["pending", "confirmed"] },
          startTime: { $lt: endTime },
          endTime: { $gt: startTime },
        },
        { session }
      );

      if (existing) return "BOOKING_EXISTS";

      await studioBookingCollection.insertOne(
        {
          ...req.body,
          customerEmail: email,
          reviewSubmitted: false,
          status: "pending",
          createdAt: new Date(),
        },
        { session }
      );

      return "SUCCESS";
    })
    .finally(() => session.endSession());

  if (result === "STUDIO_NOT_FOUND") {
    return res.send({ message: "Studio not available" });
  }

  if (result === "BOOKING_EXISTS") {
    return res.send({
      message: "This time slot is already booked",
    });
  }

  res.send({ message: "Booking successful" });
});

// Get booked time slots for a studio
app.get("/studios/:id/availability", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.send({
      message: "Invalid studio ID",
    });
  }

  const bookings = await studioBookingCollection
    .find({
      studioId: id,
      status: { $in: ["pending", "confirmed"] },
    })
    .project({
      _id: 0,
      date: 1,
      startTime: 1,
      endTime: 1,
    })
    .toArray();

  res.send(bookings);
});

// Mark a confirmed booking as completed
app.patch("/studios/booking/:id/complete", async (req, res) => {
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

  const endTime = new Date(`${booking.date}T${booking.endTime}:00`);

  if (new Date() <= endTime) {
    return res.send({ message: "Booking time is not over yet" });
  }

  const result = await studioBookingCollection.updateOne(
    { _id: new ObjectId(id), status: "confirmed" },
    {
      $set: {
        status: "completed",
        completedAt: new Date(),
      },
    }
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
    .find({ status: "live" })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();

  res.send(latestStudio || null);
});



// Get studio counts grouped by category
app.get("/stats/categories", async (req, res) => {
  const result = await studiosCollection
    .aggregate([
      { $match: { status: "live" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ])
    .toArray();

  res.send(
    Object.fromEntries(result.map(({ _id, count }) => [_id, count])),
  );
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
    }))
  );
});


// Get a studio by slug or ID
app.get("/studios/:slug", async (req, res) => {
  const { slug } = req.params;

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);

  const filter = isObjectId
    ? { _id: new ObjectId(slug) }
    : { slug };

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
    .find({ status: "live" })
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
    .find({ status: "live" })
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
          (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1),
        )
      : null,
  });
});



export async function disconnectFromMongoDB() {
  await client.close();
}


app.listen(PORT, ()=> {
    console.log(`Server is running on port ${PORT}`)
});