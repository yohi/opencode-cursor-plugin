const stream = new ReadableStream({
  start(controller) {
    controller.enqueue({ type: "text-delta", text: "hello" });
    controller.close();
  }
});

try {
  const res = new Response(stream as any);
  console.log("Response created");
  res.text().then(text => console.log("Text:", text)).catch(err => console.error("Error reading:", err));
} catch (e) {
  console.error("Error creating response:", e);
}
