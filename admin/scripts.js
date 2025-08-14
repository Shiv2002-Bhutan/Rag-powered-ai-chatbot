document.addEventListener("DOMContentLoaded", () => {
  const pdfCheck = document.getElementById("selectPDF");
  const urlCheck = document.getElementById("selectURL");
  const pdfSection = document.getElementById("pdfSection");
  const urlSection = document.getElementById("urlSection");
  const form = document.getElementById("uploadForm");
  const messageDiv = document.getElementById("message");
  const statusBox = document.getElementById("status");
  const submitBtn = form.querySelector("button[type='submit']");

  // Toggle sections based on checkbox
  const toggleSections = () => {
    pdfSection.classList.toggle("hidden", !pdfCheck.checked);
    urlSection.classList.toggle("hidden", !urlCheck.checked);
  };

  pdfCheck.addEventListener("change", toggleSections);
  urlCheck.addEventListener("change", toggleSections);

  // Initial toggle on load
  toggleSections();

  async function checkStatus() {
    try {
      const res = await fetch("http://localhost:5000/status");
      if (!res.ok) throw new Error("Status check failed");
      const data = await res.json();
      statusBox.textContent = data.message;
    } catch {
      statusBox.textContent = "⚠️ Unable to reach backend.";
    }
  }
  checkStatus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    messageDiv.textContent = "";
    messageDiv.style.color = "black";

    if (!pdfCheck.checked && !urlCheck.checked) {
      messageDiv.style.color = "red";
      messageDiv.textContent = "Please select at least one data type.";
      return;
    }

    const fileInput = pdfSection.querySelector("#pdfFile");
    const urlInput = urlSection.querySelector("#urlInput");

    const fileProvided = pdfCheck.checked && fileInput.files.length > 0;
    const urlProvided = urlCheck.checked && urlInput.value.trim() !== "";

    if (pdfCheck.checked && !fileProvided) {
      messageDiv.style.color = "red";
      messageDiv.textContent = "Please upload a PDF file.";
      return;
    }

    if (urlCheck.checked && !urlProvided) {
      messageDiv.style.color = "red";
      messageDiv.textContent = "Please enter a valid URL.";
      return;
    }

    const formData = new FormData();
    if (fileProvided) formData.append("pdf", fileInput.files[0]);
    if (urlProvided) formData.append("url", urlInput.value.trim());

    try {
      // Disable button and show loading text
      submitBtn.disabled = true;
      messageDiv.style.color = "black";
      messageDiv.textContent = "Uploading... ⏳";

      const response = await fetch("http://localhost:5000/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        messageDiv.style.color = "green";
        messageDiv.textContent = result.message || "✅ Upload successful!";
        form.reset();
        toggleSections();
        checkStatus();
      } else {
        messageDiv.style.color = "red";
        messageDiv.textContent = result.error || "❌ Upload failed.";
      }
    } catch (error) {
      messageDiv.style.color = "red";
      messageDiv.textContent = "⚠️ Network error or server not running.";
      console.error(error);
    } finally {
      // Re-enable submit button regardless of outcome
      submitBtn.disabled = false;
    }
  });
});
