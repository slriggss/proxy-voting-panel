// Classifies a shareholder proposal by the direction it pushes a company.
//
// The SEC's N-PX vote categories say what a proposal is about (climate,
// diversity, human rights...) but not which way it points: "report on the
// effectiveness of DEI efforts" and "report on risks created by DEI efforts"
// share a category but come from opposite camps. Voting against the second
// is not an anti-ESG vote, so support rates need the direction.
//
// stanceOf(text) returns { stance, rule }:
//   stance: 'anti-ESG'  asks the company to retreat from, or report the risks
//                       of, climate / DEI / human-rights commitments
//           'pro-ESG'   asks for more climate, social or human-rights action
//                       or disclosure
//           'unclear'   topics filed by both camps (e.g. charitable giving)
//           'governance' shareholder rights, board and pay mechanics, plus anything
//                       no rule recognizes (counted as 'governance & other')
//   rule:   the name of the rule that matched, so every call can be audited.
//
// Rules are checked in order: anti-ESG first (their wording often reuses
// ESG vocabulary), then two-sided topics, then pro-ESG, then governance.

const RULES = [
  // --- anti-ESG -----------------------------------------------------------
  ['anti-ESG', 'china dependence', /china (entanglement|exposure|business)|vulnerable to china|reliance on china|depend(ence|ent)? on china|operations in china|chinese military/i],
  ['anti-ESG', 'viewpoint/ideological diversity', /viewpoint|ideolog/i],
  ['anti-ESG', 'politicized debanking', /de-?banking|politicized/i],
  ['anti-ESG', 'risks of DEI', /risks?[^.]{0,80}(diversity, equity|\bdei\b|affirmative action|inclusion (efforts|programs|policies))|(\bdei\b|diversity, equity,? (and|&) inclusion)[^.]{0,40}(and related )?risks|affirmative action|return to merit|merit[- ]based/i],
  ['anti-ESG', 'costs/risks of climate commitments', /(risks?|costs?)( and benefits)?[^.]{0,60}(net[- ]zero|climate[- ](related )?(commitments|activities|goals|targets)|decarboni[sz]|energy transition|emissions? reduction (goals|targets|commitments))|withdraw[^.]{0,60}(net[- ]zero|paris|climate|alliance)|\b(reconsider|rescind|abandon|end|restrict)\b[^.]{0,40}(net[- ]zero|climate|emissions)/i],
  ['anti-ESG', 'civil liberties / censorship', /civil liberties|censorship|free speech|freedom of expression|anti-american|h-1b/i],
  ['anti-ESG', 'HRC index / affiliations', /human rights campaign|corporate equality index|\bhrc\b|\bcei\b|company affiliations|(ending|end|cease) (participation|membership)/i],
  ['anti-ESG', 'sex-based / gender transition', /sex-based|biological sex|gender (transition|affirming|ideology)|pro-life|unborn|opposing[^.]{0,40}abortion/i],
  ['anti-ESG', 'religious discrimination', /religio|faith-based|christian/i],
  ['anti-ESG', 'anti-ESG research & proxy-voting asks', /energy policy research foundation|financial substantiality|misaligning proxy votes|client preferences/i],
  ['anti-ESG', 'charitable giving discrimination', /discrimination[^.]{0,40}charitab|charitab[^.]{0,60}discrimination/i],
  ['anti-ESG', 'ESG pay metrics / returns', /non-fiduciary|(revisit|remove|eliminate)[^.]{0,30}(\bde[il]\b|diversity|esg)[^.]{0,30}(pay|compensation|incentive)|risks? of (esg|\bdei\b)[^.]{0,30}(compensation|pay|metrics)|esg roi|stakeholder capitalism|meritocra|misalignment between[^.]{0,60}customer/i],

  // --- pay tied to ESG goals, and living-income asks (found by the hand audit) ---
  ['pro-ESG', 'ESG-linked pay', /(incentive|compensation|pay|bonus)[^.]{0,60}\b(esg|sustainability|climate|diversity)\b[^.]{0,20}(objectives|metrics|targets|goals|performance)|(esg|climate|sustainability)[- ]linked (pay|compensation|incentive)/i],
  ['pro-ESG', 'human rights & labor', /living income/i],

  // --- filed by both camps ------------------------------------------------
  ['unclear', 'charitable giving', /charitable/i],
  // (second-chance hiring and AI's effect on jobs are pro-ESG labor asks)
  ['pro-ESG', 'human rights & labor', /incarcerat|arrest[^.]{0,20}record|second[- ]chance|workforce impact of a[il]\b/i],
  ['pro-ESG', 'human rights & labor', /non-? ?interference|paid sick leave|safety practices|protected classes|railroad safety|responsible sourcing|same amount of benefit/i],
  ['pro-ESG', 'climate & environment', /circular economy|operations waste|global warming|road wear|nuclear|lead[- ]sheathed/i],
  ['pro-ESG', 'health, safety & product impact', /quality (of )?(accessible medical )?care|social media|rekognition|public benefit corporation/i],
  ['unclear', 'other two-sided topics', /hiring practices|adoption of automation|immigration|merchant category code|sweetener|ingredient|greenwash|advertising risk|ad buyer|brand image|protect retirement benefits|data center costs|proxy voting|voting preferences|retirement plan investment|takedown|take down|electromagnetic|corporate (contributions|giving)/i],

  // --- pro-ESG ------------------------------------------------------------
  ['pro-ESG', 'climate & environment', /climate|emission|ghg|greenhouse|carbon|paris|net[- ]zero|scope 3|fossil|renewable|clean energy|deforest|plastic|packaging|recycl|\bwater|biodiversity|\bnature\b|methane|pollut|environment|sustainab|toxic|pesticide|\bchemical|energy efficiency|\bcoal\b|oil and gas|data centers|energy (supply )?(financing )?ratio|just transition|transition finance|extended producer|filter cleanup|cigarette waste|deep sea mining|stakeholder impact|social impact|plant-based/i],
  ['pro-ESG', 'human rights & labor', /human rights|indigenous|child labor|forced labor|worker|workforce|\blabor|freedom of association|collective bargaining|living wage|\bwages?\b|workplace safety|\bheat\b|working conditions|supply chain|due diligence|\bconflict(?! of interest)|illegal settlements|defense-related|ethical impact/i],
  ['pro-ESG', 'diversity, equity & pay gaps', /diversity|inclusion|\bdei\b|racial|gender|pay (gap|equity)|equal pay|eeo|civil rights|discriminat|harassment|reproductive|abortion|women|demographic|disabilit/i],
  ['pro-ESG', 'political spending & lobbying disclosure', /lobbying|political|congruen/i],
  ['pro-ESG', 'animal welfare', /animal|\bcage|\bpork|gestation|antibiotic|primate|poultry|chicken|\beggs?\b/i],
  ['pro-ESG', 'health, safety & product impact', /health|tobacco|smok|nicotine|opioid|drug pric|access to medicine|patent|affordab|\bfood\b|nutrition|child(ren)?'?s? (safety|online)|online safety|\bguns?\b|firearm|weapon|patient safety|quality of care/i],
  // Some filers render "AI" as "Al" (lower-case L).
  ['pro-ESG', 'AI, data & digital rights', /artificial intelligence|\bai\b|\ba[il]\b[^.]{0,25}(data|bias|usage|oversight|chatbot|model|misinformation)|chatbot|generative|algorithm|privacy|customer data|(use of|report on) a[il]\b|law enforcement|digital services|customer use of|tax practices|misinformation|disinformation|surveillance|facial recognition|\bhate\b|antisemit|exploitation|deepfake|content moderation/i],
  ['pro-ESG', 'tax transparency', /tax transparen|country-by-country/i],

  // --- governance and pay ---------------------------------------------------
  ['governance', 'shareholder rights & board', /special meeting|written consent|declassif|majority vote|simple majority|supermajority|proxy access|independent (board )?chair|chair(man)? .*independent|poison pill|dual[- ]class|one vote per share|equal voting|director|board|bylaw|charter|nominat|term limit|annual election|cumulative voting|shareholder approval|advisory vote|ratif/i],
  ['governance', 'executive pay', /compensation|\bpay|severance|golden parachute|clawback|bonus|equity awards?|stock options?|retention|incentive/i],
];

// Strip the boilerplate filers wrap around proposal titles.
function clean(text) {
  return String(text)
    .replace(/^(to (vote on|act upon|consider)|vote on|approve request on)\s+/i, '')
    .replace(/^(a )?(shareholder|stockholder|share ?holder|shareowner)s?( proposal)?s?[\s:,-]*(entitled|regarding|requesting|relating to|seeking|on|to|for|that)?\s*/i, '')
    .replace(/,?\s*if (properly )?presented( at (the|our) (annual |special )?meeting( of (share|stock)holders)?)?,?/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stanceOf(text) {
  const t = clean(text);
  for (const [stance, rule, re] of RULES) {
    if (re.test(t)) return { stance, rule };
  }
  return { stance: 'governance', rule: 'no rule matched' };
}

module.exports = { stanceOf, clean, RULES };
