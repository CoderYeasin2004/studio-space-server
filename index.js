import express from "express";
import cors from "cors";
import { MongoClient } from 'mongodb';
import 'dotenv/config'


const PORT = process.env.PORT || 5000;

const app = express()
app.use(cors(["http://localhost:3000"]))
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

app.post("/studios", async(req, res) => {
    const studioData = req.body;

    const result = await studiosCollection.insertOne(studioData)

    res.send(result)
})
// app.get("/studios/:slug", async(req, res) => {
// const slug = req.params.slug;
// console.log(slug, 'slug')
// res.send({massage: `Your requested studio with slug: ${slug}`})
// })
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