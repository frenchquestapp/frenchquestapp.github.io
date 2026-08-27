// French Quest external form links

window.frenchQuestLinks = {
  waitlist: "https://forms.gle/cgmTvvnV7hXWH4gQ8",
  feedback: "https://forms.gle/qqwyvQ2wFDUZEk8bA"
};

handleExternalAction = function(type) {
  const url = window.frenchQuestLinks[type];

  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  alert("This form is coming soon.");
};
