
# 🌦️ Weather Report App

A simple Node.js + Express REST API app that allows users to **create**, **read**, **update**, and **delete** (CRUD) weather reports. Built with **MongoDB** and **Mongoose**, this app demonstrates middleware use, model handling, and API route structuring.

---

## 📁 Features

- Create weather reports
- Read a specific report by ID
- Update existing reports
- Delete reports
- Middleware for fetching report by ID
- Request validation with error handling

---

## 🛠️ Tech Stack

- **Node.js**
- **Express.js**
- **MongoDB** (via Mongoose)
- **dotenv**
- **nodemon** (for development)
- **validator**
- **jwtwebtoken**
- **bcryptjs**
- **cookie-parser**

---

## 📦 Installation

```bash
git clone https://github.com/your-username/weatherapp.git
cd weatherapp
npm install
```

---

## ⚙️ Configuration

Create a `.env` file in the root with the following:

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/weatherapp
```

> Replace the MongoDB URI with your own if necessary.

---

## 🚀 Running the App

```bash
# Development mode
npm run dev

# Production
npm start
```

---

## 📬 API Endpoints

| Method | Route                | Description            |
|--------|---------------------|------------------------|
| GET    | `/report/:id`       | Get a single report    |
| POST   | `/report`           | Create a new report    |
| PUT    | `/report/:id`       | Update an existing one |
| DELETE | `/report/:id`       | Delete a report        |

---

## 🧠 Sample Report Schema

```json
{
  "title": "Heavy Rain in Lagos",
  "location": "Lagos, Nigeria",
  "desc": "Strong winds and heavy rainfall expected throughout the week."
}
```

---

## ✨ Example Usage

### Create a report

```http
POST /report
Content-Type: application/json

{
  "title": "Sunny Day",
  "location": "Cairo",
  "desc": "Clear skies with warm temperatures"
}
```

---

## 🧩 Folder Structure

```
weatherapp/
│
├── models/
│   └── Report.js         # Mongoose model
│
├── middlewares/
│   └── getreport.js      # Middleware to fetch report by ID
│
├── index.js              # Main entry point
├── .env                  # Environment config
└── README.md             # You are here 😄
```

---

## 🐞 Error Handling

Graceful responses with `400`, `404`, and `500` status codes depending on the error context. All errors are logged to the console.

---

## 🧪 Future Improvements

- User authentication
- Filtering and search
- File/image upload support
- Frontend UI

---




