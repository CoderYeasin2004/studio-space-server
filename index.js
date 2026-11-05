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

app.post("/studios", async(req, res) => {
    const studioData = req.body;

    const result = await studiosCollection.insertOne(studioData)

    res.send(result)
})


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
    { $set: { status: "confirmed" } }
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
  const id = req.params.id;
  const updatedData = req.body;

  const result = await studiosCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedData }
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
const result = await studiosCollection.find().toArray();
res.send(result)
});

export async function disconnectFromMongoDB() {
  await client.close();
}


app.listen(PORT, ()=> {
    console.log(`Server is running on port ${PORT}`)
});