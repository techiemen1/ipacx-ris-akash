const express = require("express");
const router = express.Router();
const mwlController = require("../controllers/mwlController");

router.get("/", mwlController.getWorklist);

module.exports = router;
