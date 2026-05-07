async function* generator() {
  yield "hello";
  yield "world";
}

try {
  const stream = generator();
  const res = new Response(stream as any);
  console.log("Success");
} catch (e) {
  console.error("Error:", e);
}
