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

app.delete("/studios/:id", async(req, res) => {
  const slug = req.params.slug;
  const result = await studiosCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result)
})

app.post("/studios/booking", async (req, res) => {
  try {
    const bookingData = req.body;

    const result = await studioBookingCollection.insertOne({
      ...bookingData,
      createdAt: new Date(),
    });

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Booking failed" });
  }
});

app.get("/studios/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const studio = await studiosCollection.findOne({ slug });

    if (!studio) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    res.send(studio);
  } catch (error) {
    console.error("Failed to fetch studio:", error);

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