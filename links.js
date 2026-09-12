// French Quest external form links

window.frenchQuestLinks = {
  waitlist: "https://forms.gle/cgmTvvnV7hXWH4gQ8",
  feedback: "https://forms.gle/qqwyvQ2wFDUZEk8bA",
  analytics: "https://script.google.com/macros/s/AKfycbwGXYxCCRQUnfCeMFe1ubxvOjvkwLbjyDktMsFyK-QYtHtzZaougHRTkJ68uJ0zdAK_Mw/exec"
};

handleExternalAction = function(type, options = {}) {
  window.trackFrenchQuestExternalAction?.(type, options);

  const url = window.frenchQuestLinks[type];

  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  alert("This form is coming soon.");
};
