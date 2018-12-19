const defaultEmoji = ":tada:";

const keywords = {
  wine: ":wine_glass:",
  cookie: ":cookie:",
  pizza: ":pizza:",
  "happy hour": ":cocktail:",
  beers: ":beers:",
  beer: ":beer:",
  book: ":book:",
  lunch: ":fork_and_knife:",
  dinner: ":knife_fork_plate:",
  coffee: ":coffee:",
};

const getEmoji = text => {
  let emoji = "";
  const value = text.toLowerCase();
  Object.keys(keywords).forEach(key => {
    if (value.includes(key)) {
      emoji = keywords[key];
    }
  });
  return emoji || defaultEmoji;
};

module.exports.getEmoji = getEmoji;
