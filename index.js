const express = require("express")
const ordersRouter = require("./routes/orders")

const app = express()
const PORT = process.env.PORT || 3000

app.use("/", ordersRouter)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
