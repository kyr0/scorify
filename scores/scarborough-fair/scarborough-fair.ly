% The third <score> of the Wikipedia article "Scarborough Fair (ballad)", revision 1379343994, unchanged.
% https://en.wikipedia.org/w/index.php?title=Scarborough_Fair_%28ballad%29&oldid=1379343994 (CC BY-SA 4.0)
% as used in File:Scarborough Fair.ogg at Commons
\header { tagline = ##f arranger = "Version commonly used today" }

global = { \key d \dorian \time 3/4 }

chordNames = \chordmode { \global \set chordChanges = ##t
  \set Staff.midiInstrument = "acoustic guitar (nylon)"
  \transpose c c, {
  d2.:min\ppp | q | a:min | d:min |
  a:m | d:min | d4:min g2 | d2.:min |
  d:min | a:min | d:min | a:min |
  d:min | a:min7 | a:min7 | d:min \bar "|." }
}

sopranoVoice = \relative c' { \global \set Staff.midiInstrument = "clarinet"
  d2 4 | a'8 a4. a4 | e4. f8 e4 | d2. |
  r4 a' c4 | d2 c4 | a b g | a2 d4 |
  2 4 | c2 a4 | a g f | e2. |
  d2 a'4 | g2 f4 | e d c | d2. \bar "|."
}

verse = \lyricmode {
  Are you go -- ing to Scar -- bor -- ough Fair?
  Pars -- ley, sage, rose -- ma -- ry, and thyme.
  Re -- mem -- ber me to one who lives there,
  she once was a true love of mine.
}

\score {
  <<
    \new ChordNames \chordNames
    \new Staff \sopranoVoice \addlyrics \verse
  >>
  \layout { indent = 0 \context { \Score \remove "Bar_number_engraver" } }
  \midi { \tempo 4. = 90 }
}
