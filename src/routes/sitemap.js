import express from "express";
import Doctor from "../models/Doctor.js";
import Hospital from "../models/Hospital.js";
import { BANGLADESH_CITIES, SPECIALTIES } from "../utils/cities.js";
import { slugify } from "../utils/slug.js";

const router = express.Router();

const SITE_URL = "https://doctorbd.info";

const escapeXml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

router.get("/sitemap.xml", async (req, res) => {
  try {
    const [doctors, hospitals] = await Promise.all([
      Doctor.find({})
        .select("_id slug updatedAt")
        .lean(),

      Hospital.find({})
        .select("_id slug updatedAt")
        .lean(),
    ]);

    const urls = [];

    // Home
    urls.push({
      loc: `${SITE_URL}/`,
      changefreq: "daily",
      priority: "1.0",
    });

    // Doctors
    urls.push({
      loc: `${SITE_URL}/doctors`,
      changefreq: "daily",
      priority: "0.9",
    });

    // Hospitals
    urls.push({
      loc: `${SITE_URL}/hospitals`,
      changefreq: "daily",
      priority: "0.9",
    });

    // Specialist landing pages
    for (const specialty of SPECIALTIES) {
      urls.push({
        loc: `${SITE_URL}/specialist/${slugify(specialty)}`,
        changefreq: "weekly",
        priority: "0.7",
      });
    }

    // City landing pages
    for (const city of BANGLADESH_CITIES) {
      urls.push({
        loc: `${SITE_URL}/city/${slugify(city)}`,
        changefreq: "weekly",
        priority: "0.7",
      });
    }

    // Contact
    urls.push({
      loc: `${SITE_URL}/contact`,
      changefreq: "monthly",
      priority: "0.5",
    });

    // Individual doctors
    for (const doctor of doctors) {
      urls.push({
        loc: `${SITE_URL}/doctor/${doctor.slug || doctor._id}`,
        lastmod: doctor.updatedAt,
        changefreq: "weekly",
        priority: "0.8",
      });
    }

    // Individual hospitals
    for (const hospital of hospitals) {
      urls.push({
        loc: `${SITE_URL}/hospital/${hospital.slug || hospital._id}`,
        lastmod: hospital.updatedAt,
        changefreq: "weekly",
        priority: "0.8",
      });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
>
${urls
  .map(
    (url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>${
      url.lastmod
        ? `\n    <lastmod>${new Date(url.lastmod).toISOString()}</lastmod>`
        : ""
    }
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  } catch (error) {
    console.error("Sitemap error:", error);

    res.status(500).type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
    );
  }
});

export default router;