function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Audio Player")
    .addItem("Open Sidebar", "showSidebar")
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("sidebar")
    .setTitle("Audio Player");
  SpreadsheetApp.getUi().showSidebar(html);
}