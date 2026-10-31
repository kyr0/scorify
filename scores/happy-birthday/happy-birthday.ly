% The <score> of the Wikipedia article "Happy Birthday to You", revision 1382384043, with its music and
% words named as variables (melody, words); nothing else changed.
% https://en.wikipedia.org/w/index.php?title=Happy_Birthday_to_You&oldid=1382384043 (CC BY-SA 4.0)
melody = \relative c' {
 \set Staff.midiInstrument = #"piano"
 \key g \major
 \time 3/4
 \set Score.tempoHideNote = ##t
 \tempo 4 = 90
 \partial 4 d8. d16 | e4 d g | fis2 d8. d16 | e4 d a' | g2 d8. d16 | d'4 b g | fis( \tempo 4 = 40 e\fermata) \tempo 4 = 90 c'8. c16 | b4 g a | g2 \bar "|."
}
words = \lyricmode { Hap -- py birth -- day to you, Hap -- py birth -- day to you, Hap -- py birth -- day dear [NAME], __ Hap -- py birth -- day to you. }
