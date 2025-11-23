Great! Let’s integrate **file upload into the report submission** in your existing Express app. We'll update the **report submission route**, update the **Mongoose model** to include file info, and plug in **Multer** to handle file uploads.

---

### ✅ 1. Update the `Report` model to store file info:

```js
// models/Report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  title: String,
  location: String,
  desc: String,
  file: String, // This will store the uploaded file name
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);
```

---

### 📁 2. Create Multer middleware:

```js
// middleware/upload.js
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
  cb(null, allowedTypes.includes(file.mimetype));
};

module.exports = multer({ storage, fileFilter });
```

---

### ✍️ 3. Update the report creation route:

```js
// routes/report.js
const express = require('express');
const Report = require('../models/Report');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// Create a report with file upload
router.post('/report', auth, upload.single('file'), async (req, res) => {
  const { title, location, desc } = req.body;

  if (!title || !location || !desc) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const report = new Report({
      title,
      location,
      desc,
      file: req.file?.filename || null,
      user: req.userId
    });

    await report.save();
    res.status(201).json({ message: 'Report created', report });
  } catch (error) {
    console.error('Report upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

---

### 🧪 4. Sample HTML form (for testing via browser or Postman):
```html
<form action="/api/report" method="POST" enctype="multipart/form-data">
  <input type="text" name="title" placeholder="Title" required />
  <input type="text" name="location" placeholder="Location" required />
  <textarea name="desc" placeholder="Description" required></textarea>
  <input type="file" name="file" required />
  <button type="submit">Submit Report</button>
</form>
```

> ⚠️ Make sure the route is prefixed correctly (`/api/report`) and your token is included as a header (`Authorization: Bearer <token>`) if testing via Postman.

---

### 📦 5. Serve uploaded files:
In your `index.js`:
```js
app.use('/uploads', express.static('uploads'));
```
Now files can be accessed via `/uploads/<filename>`.

---

Would you like me to help add **report viewing**, **edit with file change**, or **multiple file upload** support too?


==============================


Express.js comes with several built-in middleware functions that can be used to handle common tasks like parsing request bodies, logging, serving static files, and more. Here's a list of the most commonly used in-built middleware functions in Express.js:

### 1. **`express.json()`**
   - **Purpose**: Parses incoming requests with JSON payloads.
   - **Usage**: This middleware parses JSON formatted request bodies and makes the parsed object available in `req.body`.
   - **Example**:
     ```js
     app.use(express.json());
     ```

### 2. **`express.urlencoded()`**
   - **Purpose**: Parses incoming requests with URL-encoded payloads.
   - **Usage**: It parses bodies from form submissions (with the `application/x-www-form-urlencoded` content type) and populates `req.body` with key-value pairs.
   - **Example**:
     ```js
     app.use(express.urlencoded({ extended: true }));
     ```

### 3. **`express.static()`**
   - **Purpose**: Serves static files (like images, CSS, JavaScript files) from a specified directory.
   - **Usage**: This middleware allows you to serve static content to the client.
   - **Example**:
     ```js
     app.use(express.static('public'));
     ```

### 4. **`express.Router()`**
   - **Purpose**: Creates modular route handlers.
   - **Usage**: It’s a built-in method to create route groups for organizing your application routes.
   - **Example**:
     ```js
     const router = express.Router();
     router.get('/', (req, res) => res.send('Hello, world!'));
     app.use('/api', router);
     ```

### 5. **`express.raw()`**
   - **Purpose**: Parses incoming requests with a raw buffer (binary data).
   - **Usage**: This middleware is used to handle request bodies that aren’t JSON or URL-encoded (e.g., image files).
   - **Example**:
     ```js
     app.use(express.raw());
     ```

### 6. **`express.text()`**
   - **Purpose**: Parses incoming requests with plain text payloads.
   - **Usage**: This middleware parses request bodies that contain text (such as `text/plain`).
   - **Example**:
     ```js
     app.use(express.text());
     ```

### 7. **`express.query()`** (Deprecated)
   - **Purpose**: Used for parsing the query string parameters.
   - **Usage**: This was deprecated in Express 4.0 in favor of `req.query` which is automatically parsed for you.
   - **Example**:
     ```js
     // Not recommended, use `req.query` instead.
     ```

### 8. **`morgan`** (Logging Middleware)
   - **Purpose**: HTTP request logging.
   - **Usage**: A third-party middleware (but widely used) for logging HTTP requests to the server. It helps in debugging and monitoring.
   - **Example**:
     ```js
     const morgan = require('morgan');
     app.use(morgan('dev'));
     ```

### 9. **`cookie-parser`** (Middleware for Cookies)
   - **Purpose**: Parses cookies attached to the incoming request.
   - **Usage**: This middleware is used to parse cookies and add them to `req.cookies`.
   - **Example**:
     ```js
     const cookieParser = require('cookie-parser');
     app.use(cookieParser());
     ```

### 10. **`helmet`** (Security Middleware)
   - **Purpose**: Adds various security-related HTTP headers.
   - **Usage**: This middleware helps secure your Express app by setting various HTTP headers (like `X-Frame-Options`, `Strict-Transport-Security`, etc.).
   - **Example**:
     ```js
     const helmet = require('helmet');
     app.use(helmet());
     ```

### 11. **`cors`** (Cross-Origin Resource Sharing)
   - **Purpose**: Enables CORS (cross-origin resource sharing) for your app.
   - **Usage**: This middleware allows you to configure the CORS headers for controlling cross-origin requests.
   - **Example**:
     ```js
     const cors = require('cors');
     app.use(cors());
     ```

### 12. **`express.session()`** (Session Management)
   - **Purpose**: Manages user sessions.
   - **Usage**: Express itself doesn't provide a built-in session middleware, but you can use `express-session` (a third-party middleware) to manage sessions in your app.
   - **Example**:
     ```js
     const session = require('express-session');
     app.use(session({ secret: 'your-secret', resave: false, saveUninitialized: true }));
     ```

### 13. **`compression`** (Response Compression Middleware)
   - **Purpose**: Compresses the HTTP response to improve performance.
   - **Usage**: Compresses the response bodies (e.g., using Gzip) before sending them to the client.
   - **Example**:
     ```js
     const compression = require('compression');
     app.use(compression());
     ```

### 14. **`body-parser`** (Deprecated for Express 4.16+)
   - **Purpose**: Parses incoming request bodies, primarily used for handling POST requests.
   - **Usage**: It was originally a separate package but is now included in Express starting from version 4.16.0 as part of `express.json()` and `express.urlencoded()`.
   - **Example**:
     ```js
     // This is now included in Express directly:
     app.use(express.json());
     app.use(express.urlencoded({ extended: true }));
     ```

### 15. **`csurf`** (CSRF Protection)
   - **Purpose**: Adds CSRF (Cross-Site Request Forgery) protection.
   - **Usage**: This middleware is used to protect your app from CSRF attacks.
   - **Example**:
     ```js
     const csrf = require('csurf');
     const csrfProtection = csrf({ cookie: true });
     app.use(csrfProtection);
     ```

---

These are the core built-in and commonly used Express middleware, along with some popular third-party middleware. You can extend and configure your Express application using a combination of these middleware functions to handle various tasks, from routing to security and logging.