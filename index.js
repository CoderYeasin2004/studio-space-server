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

app.post("/studios", async (req, res) => {
  const result = await studiosCollection.insertOne({
    ...req.body,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  res.send(result);
});


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

app.delete("/studios/booking/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid booking ID" });
  }

  const result = await studioBookingCollection.deleteOne({
    _id: new ObjectId(id),
  });

  if (!result.deletedCount) {
    return res.status(404).send({ message: "Booking not found" });
  }

  res.send(result);
});



app.patch("/studios/booking/:id/confirm", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid ID" });
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
    return res.status(404).send({ message: "Booking not found" });
  }

  res.send(result);
});

app.get("/studios/booking", async (req, res) => {
  try {
    const bookings = await studioBookingCollection.find({}).toArray();

    res.send(
      bookings.map(({ _id, ...booking }) => ({
        ...booking,
        id: _id.toString(),
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});

app.patch("/studios/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid ID" });
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


app.delete("/studios/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
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

app.post("/studios/booking", async (req, res) => {
  const { studioId, date, startTime, endTime } = req.body;

  // Validate booking
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (
    !ObjectId.isValid(studioId) ||
    !date ||
    !timePattern.test(startTime) ||
    !timePattern.test(endTime) ||
    startTime >= endTime
  ) {
    return res.status(400).send({ message: "Invalid booking details" });
  }

  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      // Lock the studio to prevent simultaneous bookings
      const lock = await studiosCollection.updateOne(
        { _id: new ObjectId(studioId), status: "live" },
        { $inc: { bookingVersion: 1 } },
        { session }
      );

      if (!lock.matchedCount) {
        throw new Error("STUDIO_NOT_FOUND");
      }

      // Check existing booking
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

      if (existing) {
        throw new Error("BOOKING_EXISTS");
      }

      // Save booking
      await studioBookingCollection.insertOne(
        {
          ...req.body,
          status: "pending",
          createdAt: new Date(),
        },
        { session }
      );
    });

    res.status(201).send({ message: "Booking successful" });

  } catch (error) {
    if (error.message === "BOOKING_EXISTS") {
      return res.status(409).send({
        message: "This time slot is already booked",
      });
    }

    if (error.message === "STUDIO_NOT_FOUND") {
      return res.status(404).send({
        message: "Studio not available",
      });
    }

    res.status(500).send({ message: "Booking failed" });

  } finally {
    await session.endSession();
  }
});

app.get("/studios/:id/availability", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
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

app.patch("/studios/booking/:id/complete", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid ID" });
  }

  const booking = await studioBookingCollection.findOne({
    _id: new ObjectId(id),
  });

  if (!booking) {
    return res.status(404).send({ message: "Booking not found" });
  }

  if (booking.status !== "confirmed") {
    return res.status(409).send({ message: "Booking is not confirmed" });
  }

  const endTime = new Date(`${booking.date}T${booking.endTime}:00`);

  if (new Date() <= endTime) {
    return res.status(400).send({ message: "Booking time is not over yet" });
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
    return res.status(409).send({ message: "Booking already processed" });
  }

  res.send({ message: "Booking completed successfully" });
});


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



app.get("/studios/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(slug);

    const filter = isObjectId
      ? { _id: new ObjectId(slug) }
      : { slug };

    const studio = await studiosCollection.findOne(filter);

    if (!studio) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    res.send({
      ...studio,
      id: studio._id.toString(),
    });
  } catch {
    res.status(500).send({
      message: "Internal server error",
    });
  }
});



app.get("/studios", async (req, res) => {
  try {
    const limitParam = req.query.limit;

    let limitValue = null;
    if (limitParam !== undefined) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).send({
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
  } catch (error) {
    console.error("Failed to fetch studios:", error);
    res.status(500).send({
      message: "Failed to fetch studios",
    });
  }
});

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