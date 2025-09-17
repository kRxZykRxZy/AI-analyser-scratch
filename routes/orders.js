const express = require("express")
const fetch = require("node-fetch")
const cheerio = require("cheerio")
const { Client } = require("@google/genai")

const router = express.Router()
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const client = new Client({ apiKey: GEMINI_API_KEY })
const SCRATCH_TOPIC_URL = "https://scratch.mit.edu/discuss/topic/838820/"

const ORDER_FORM_REGEX = new RegExp(
  "Username:\\s*(.*?)\\s*" +
    "Service Required:\\s*(.*?)\\s*" +
    "Description:\\s*(.*?)\\s*" +
    "Preferred Shop \\(optional\\):\\s*(.*?)\\s*" +
    "Do you agree to our Terms of Service:\\s*(.*?)\\s*" +
    "Other:\\s*(.*)",
  "is"
)

async function fetchAllPosts() {
  let posts = []
  let page = 1
  while (true) {
    const url = `${SCRATCH_TOPIC_URL}?page=${page}`
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
    if (!res.ok) break
    const html = await res.text()
    const $ = cheerio.load(html)
    const pagePosts = $(".postbody").map((i, el) => $(el).text().trim()).get()
    if (pagePosts.length === 0) break
    posts = posts.concat(pagePosts)
    page++
  }
  return posts.slice(3)
}

function extractOrders(posts) {
  const orders = []
  posts.forEach((post, idx) => {
    const match = ORDER_FORM_REGEX.exec(post)
    if (match) {
      const username = match[1].trim()
      const replies = posts
        .slice(idx + 1)
        .filter(p => p.includes(username) || p.includes(match[3].trim()))
      orders.push({
        post_index: idx + 4,
        Username: username,
        ServiceRequired: match[2].trim(),
        Description: match[3].trim(),
        PreferredShop: match[4].trim(),
        AgreedToS: match[5].trim(),
        Other: match[6].trim(),
        replies
      })
    }
  })
  return orders
}

async function classifyOrder(order) {
  if (!GEMINI_API_KEY) return false
  const repliesText = order.replies.slice(0, 10).join("\n\n")
  const prompt =
    "You are analyzing a Scratch forum shop order.\n" +
    "An order is COMPLETED if there is a reply suggesting the order is fulfilled, " +
    "work delivered, communication to external shops, or a status update that it is done.\n" +
    "It is UNCOMPLETED if there are no such replies or confirmation.\n\n" +
    `Order form:\nUsername: ${order.Username}\nService Required: ${order.ServiceRequired}\nDescription: ${order.Description}\nPreferred Shop: ${order.PreferredShop}\nOther: ${order.Other}\n\n` +
    `Replies referencing this order:\n${repliesText}\n\n` +
    "Respond only with COMPLETED or UNCOMPLETED."

  const response = await client.responses.create({
    model: "gemini-2.5-preview",
    input: prompt
  })

  const text = response.output[0].content[0].text.trim().toUpperCase()
  return text === "COMPLETED"
}

router.get("/api/orders", async (req, res) => {
  try {
    const posts = await fetchAllPosts()
    const orders = extractOrders(posts)
    const completed = []
    const uncompleted = []
    for (const order of orders) {
      const isCompleted = await classifyOrder(order)
      const entry = {
        Username: order.Username,
        ServiceRequired: order.ServiceRequired,
        Description: order.Description,
        PreferredShop: order.PreferredShop,
        AgreedToS: order.AgreedToS,
        Other: order.Other,
        post_index: order.post_index
      }
      if (isCompleted) completed.push(entry)
      else uncompleted.push(entry)
    }
    res.json({ uncompleted, completed })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
