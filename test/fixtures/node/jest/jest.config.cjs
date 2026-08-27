module.exports = {
  reporters: [
    "default",
    ["jest-junit", { outputDirectory: "artifacts", outputName: "junit.xml" }],
  ],
};
