# iPACX RIS - Quick-Start Implementation Guide

## Phase 1 Priority Implementations (First 30 Days)

---

## 1. SECRETS MANAGEMENT SETUP

### Current Issue
```javascript
// ❌ DANGEROUS - In docker-compose.yml
JWT_SECRET=bhEs3RR+q74v+rK3w/3dWWTpiBpEXZ++KT7wrxMWjyUSsETbpJvORaEoAGpA+ejq
POSTGRES_PASSWORD=lekhana
```

### Solution: Using dotenv properly + .gitignore

**Step 1: Update `.gitignore`**
```bash
# .gitignore
.env
.env.local
.env.*.local
secrets/
vault/
```

**Step 2: Create `.env.example`**
```bash
# .env.example (commit this, NOT .env)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=CHANGE_ME_IN_PRODUCTION
JWT_SECRET=CHANGE_ME_IN_PRODUCTION
JWT_EXPIRY=24h
FRONTEND_URL=http://localhost:3000
ORTHANC_URL=http://orthanc:8042/
```

**Step 3: Generate secure secrets**
```bash
# Generate random secure JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate secure database password
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

**Step 4: Update backend configuration**
```javascript
// backend/config.js (NEW FILE)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'ris',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiryTime: process.env.JWT_EXPIRY || '24h',
  },
  orthanc: {
    url: process.env.ORTHANC_URL || 'http://localhost:8042/',
    username: process.env.ORTHANC_USER || 'orthanc',
    password: process.env.ORTHANC_PASS || 'orthanc',
  },
  port: process.env.PORT || 5000,
};

// Validation on startup
const config = module.exports;
if (!config.jwt.secret) {
  throw new Error('JWT_SECRET not configured!');
}
if (!config.database.password) {
  throw new Error('POSTGRES_PASSWORD not configured!');
}
```

---

## 2. INPUT VALIDATION FRAMEWORK

### Installation
```bash
cd backend
npm install joi express-validator express-rate-limit helmet
npm install --save-dev @types/joi
```

### Create Validation Layer

**backend/validators/auth.js**
```javascript
const { body, validationResult } = require('express-validator');

const validateLogin = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9._-]+$/).withMessage('Username contains invalid characters'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

const validateUserCreation = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9._-]+$/).withMessage('Username contains invalid characters'),
  body('email')
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail(),
  body('full_name')
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ max: 100 }).withMessage('Full name too long'),
  body('role')
    .isIn(['USER', 'TECHNICIAN', 'RADIOLOGIST', 'ADMIN']).withMessage('Invalid role'),
  body('password')
    .isLength({ min: 12 }).withMessage('Password must be at least 12 characters')
    .matches(/[A-Z]/).withMessage('Password must contain uppercase')
    .matches(/[a-z]/).withMessage('Password must contain lowercase')
    .matches(/[0-9]/).withMessage('Password must contain numbers')
    .matches(/[!@#$%^&*]/).withMessage('Password must contain special characters'),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(e => ({
        field: e.param,
        message: e.msg
      }))
    });
  }
  next();
};

module.exports = {
  validateLogin,
  validateUserCreation,
  handleValidationErrors,
};
```

**backend/validators/patients.js**
```javascript
const { body } = require('express-validator');

const validatePatientCreation = [
  body('patient_id')
    .trim()
    .notEmpty().withMessage('Patient ID required')
    .matches(/^[A-Z0-9-]+$/).withMessage('Invalid patient ID format'),
  body('full_name')
    .trim()
    .notEmpty().withMessage('Full name required')
    .isLength({ min: 2, max: 255 }),
  body('gender')
    .isIn(['M', 'F', 'O', 'U']).withMessage('Invalid gender'),
  body('dob')
    .isISO8601().withMessage('Invalid date format'),
  body('mobile')
    .optional()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/)
    .withMessage('Invalid phone number'),
  body('email')
    .optional()
    .isEmail().withMessage('Invalid email'),
];

module.exports = {
  validatePatientCreation,
};
```

**Update routes to use validation**

**backend/routes/auth.js**
```javascript
const { validateLogin, handleValidationErrors } = require('../validators/auth');

// Before: router.post('/login', authController.login);
// After:
router.post(
  '/login',
  validateLogin,
  handleValidationErrors,
  authController.login
);
```

---

## 3. RATE LIMITING

**backend/middleware/rateLimiter.js**
```javascript
const rateLimit = require('express-rate-limit');

// Login rate limiter: 5 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Skip for test/admin accounts if needed
    return false;
  },
  keyGenerator: (req, res) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// General API limiter: 100 requests per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for sensitive operations: 10 per hour
const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many requests for this operation',
});

module.exports = {
  loginLimiter,
  apiLimiter,
  strictLimiter,
};
```

**Update server.js**
```javascript
const { loginLimiter, apiLimiter } = require('./middleware/rateLimiter');

// Apply global rate limiter
app.use('/api/', apiLimiter);

// Apply login rate limiter
app.post('/api/login', loginLimiter, authController.login);
```

---

## 4. CSRF PROTECTION

**Installation**
```bash
npm install csurf cookie-parser
```

**backend/middleware/csrf.js**
```javascript
const csrf = require('csurf');
const cookieParser = require('cookie-parser');

// CSRF protection middleware
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
});

module.exports = {
  csrfProtection,
  cookieParser
};
```

**Update server.js**
```javascript
const { csrfProtection, cookieParser } = require('./middleware/csrf');

// Parse cookies first
app.use(cookieParser());

// Apply CSRF protection to all POST/PUT/DELETE requests
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    csrfProtection(req, res, next);
  } else {
    next();
  }
});

// Provide CSRF token to frontend
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});
```

**Frontend usage**
```javascript
// Get CSRF token on app load
useEffect(() => {
  api.get('/api/csrf-token')
    .then(res => {
      localStorage.setItem('csrfToken', res.data.csrfToken);
    });
}, []);

// Include CSRF token in requests
api.interceptors.request.use(config => {
  const csrfToken = localStorage.getItem('csrfToken');
  if (csrfToken && ['POST', 'PUT', 'DELETE'].includes(config.method.toUpperCase())) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});
```

---

## 5. STRUCTURED LOGGING

**Installation**
```bash
npm install winston
```

**backend/utils/logger.js**
```javascript
const winston = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
  ),
  defaultMeta: { service: 'ipacx-ris' },
  transports: [
    // Error logs
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 10,
    }),
  ],
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
    ),
  }));
}

module.exports = logger;
```

**Use in controllers**
```javascript
const logger = require('../utils/logger');

router.post('/login', async (req, res) => {
  try {
    logger.info('Login attempt', {
      username: req.body.username,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // ... login logic

    logger.info('User logged in successfully', {
      userId: user.id,
      username: user.username,
    });
  } catch (error) {
    logger.error('Login failed', {
      username: req.body.username,
      error: error.message,
      stack: error.stack,
    });
  }
});
```

---

## 6. HTTPS/TLS CONFIGURATION

**nginx.conf**
```nginx
server {
    listen 80;
    server_name _;
    # Redirect all HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (from Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # ... rest of nginx config
}
```

**docker-compose.yml update**
```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/letsencrypt:ro
    networks:
      - ipacx-network
```

---

## 7. COMPREHENSIVE ERROR HANDLING

**backend/utils/errors.js**
```javascript
class AppError extends Error {
  constructor(message, statusCode, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 400, details);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, {});
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, {});
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, {});
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database error', details = {}) {
    super(message, 500, details);
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  DatabaseError,
};
```

**backend/middleware/errorHandler.js**
```javascript
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  // Log error
  logger.error('Unhandled error', {
    message: err.message,
    statusCode: err.statusCode || 500,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    stack: err.stack,
  });

  // Default error response
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const details = process.env.NODE_ENV === 'development' ? err.details : {};

  res.status(statusCode).json({
    success: false,
    message,
    ...(Object.keys(details).length > 0 && { details }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
```

**Update server.js**
```javascript
const errorHandler = require('./middleware/errorHandler');

// At the end of server.js
app.use(errorHandler);
```

---

## 8. DATABASE SECURITY

**Update connection with SSL**
```javascript
// backend/db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'ris',
  // SSL configuration
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  // Connection pool configuration
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;
```

**docker-compose.yml - secure PostgreSQL**
```yaml
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ris
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./schema.sql:/docker-entrypoint-initdb.d/schema.sql
    command:
      - "postgres"
      - "-c"
      - "ssl=on"
      - "-c"
      - "ssl_cert_file=/var/lib/postgresql/server.crt"
      - "-c"
      - "ssl_key_file=/var/lib/postgresql/server.key"
```

---

## 9. FILE UPLOAD SECURITY

**backend/middleware/fileUploadValidator.js**
```javascript
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Allowed file types by MIME type
const ALLOWED_MIMES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate random filename
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, randomName + path.extname(file.originalname));
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMES[file.mimetype]) {
    return cb(new Error(`File type ${file.mimetype} not allowed`));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

module.exports = upload;
```

**Use in routes**
```javascript
const upload = require('../middleware/fileUploadValidator');

router.post('/upload-signature', upload.single('signature'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  res.json({
    success: true,
    path: `/uploads/signatures/${req.file.filename}`,
  });
});
```

---

## 10. INITIAL TESTING SETUP

**Installation**
```bash
npm install --save-dev jest @testing-library/react @testing-library/jest-dom supertest
```

**backend/jest.config.js**
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'routes/**/*.js',
    'controllers/**/*.js',
    'services/**/*.js',
    '!**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
};
```

**backend/__tests__/auth.test.js**
```javascript
const request = require('supertest');
const app = require('../server');
const pool = require('../db');

describe('Authentication Routes', () => {
  afterAll(async () => {
    await pool.end();
  });

  test('POST /api/login with valid credentials', async () => {
    const response = await request(app)
      .post('/api/login')
      .send({
        username: 'admin',
        password: 'admin123'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('token');
  });

  test('POST /api/login with invalid credentials', async () => {
    const response = await request(app)
      .post('/api/login')
      .send({
        username: 'invalid',
        password: 'wrong'
      });

    expect(response.statusCode).toBe(401);
  });

  test('POST /api/login without username', async () => {
    const response = await request(app)
      .post('/api/login')
      .send({
        password: 'test123'
      });

    expect(response.statusCode).toBe(400);
  });
});
```

**Run tests**
```bash
npm test
npm run test:coverage
```

---

## QUICK CHECKLIST - FIRST 30 DAYS

### Week 1: Secrets & Environment
- [ ] Create `.env.example`
- [ ] Generate secure secrets
- [ ] Remove hardcoded credentials
- [ ] Update docker-compose.yml
- [ ] Test with new secrets

### Week 2: Input Validation
- [ ] Install validation packages
- [ ] Create validators directory
- [ ] Update auth routes
- [ ] Update patient routes
- [ ] Add error handling

### Week 3: Rate Limiting & CSRF
- [ ] Implement rate limiter
- [ ] Add CSRF protection middleware
- [ ] Update frontend to use CSRF tokens
- [ ] Test rate limiting
- [ ] Document security changes

### Week 4: Logging & Error Handling
- [ ] Set up Winston logger
- [ ] Update all controllers with logging
- [ ] Implement error handler
- [ ] Configure HTTPS/TLS
- [ ] Add basic test suite

---

## DEPLOYMENT CHECKLIST

Before deploying to production:

```bash
# Security scan
npm audit fix

# Format code
npm run lint

# Run tests
npm test -- --coverage

# Build optimized bundle
npm run build

# Security headers verification
curl -I https://your-domain.com

# SSL certificate check
openssl s_client -connect your-domain.com:443
```

---

## ESTIMATED EFFORT

| Task | Hours | Team |
|------|-------|------|
| Secrets Management | 4 | 1 dev |
| Input Validation | 12 | 2 devs |
| Rate Limiting | 3 | 1 dev |
| CSRF Protection | 5 | 1 dev |
| Logging | 6 | 1 dev |
| Error Handling | 8 | 1 dev |
| HTTPS/TLS | 3 | 1 dev |
| File Upload Security | 5 | 1 dev |
| Testing Setup | 8 | 1 dev |
| Testing & Refinement | 10 | 2 devs |
| **TOTAL** | **64 hours** | **2-3 devs** |
| **Timeline** | **2-3 weeks** | - |

---

## SUCCESS CRITERIA

- [ ] 0 Critical security vulnerabilities
- [ ] All endpoints have input validation
- [ ] Rate limiting working and tested
- [ ] HTTPS enforced for all traffic
- [ ] Structured logging in place
- [ ] 50+ unit tests passing
- [ ] No hardcoded secrets in code/configs
- [ ] CSRF tokens protecting POST/PUT/DELETE
- [ ] Error handling consistent across APIs

---

## RESOURCES & LINKS

- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [OWASP Top 10 Prevention](https://owasp.org/Top10/)
- [PostgreSQL SSL Documentation](https://www.postgresql.org/docs/current/ssl-tcp.html)
- [Winston Logger Documentation](https://github.com/winstonjs/winston)
- [Express Validator Guide](https://express-validator.github.io/docs/)

---

**Next Review:** After completing Phase 1 implementations
