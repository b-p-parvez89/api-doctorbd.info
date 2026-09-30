export function slugify(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u0980-\u09ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-") || "profile";
}

export async function uniqueSlug(Model, value, currentId = null) {
  const base = slugify(value);
  let slug = base;
  let counter = 2;

  while (true) {
    const query = { slug };
    if (currentId) query._id = { $ne: currentId };
    const exists = await Model.exists(query);
    if (!exists) return slug;
    slug = `${base}-${counter++}`;
  }
}
