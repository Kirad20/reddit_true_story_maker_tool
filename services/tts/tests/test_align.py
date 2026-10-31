from align import Word, align, proportional, script_tokens


def assert_ordered(words, start, end):
    prev = start
    for w in words:
        assert w.start >= prev - 1e-9
        assert w.end >= w.start
        assert w.end <= end + 1e-9
        prev = w.end


def test_proportional_covers_span_in_order():
    words = proportional(["Hello", "big", "world"], 1.0, 4.0)
    assert [w.text for w in words] == ["Hello", "big", "world"]
    assert words[0].start == 1.0
    assert abs(words[-1].end - 4.0) < 1e-6
    assert_ordered(words, 1.0, 4.0)


def test_align_keeps_script_spelling_and_matched_times():
    tokens = script_tokens("Coffee grounds are natural deodorizers.")
    recognized = [
        Word("coffee", 0.0, 0.4),
        Word("grounds", 0.4, 0.8),
        Word("are", 0.8, 1.0),
        Word("natural", 1.0, 1.4),
        Word("deodorizers", 1.4, 2.2),
    ]
    words = align(tokens, recognized, 0.0, 2.5)
    assert [w.text for w in words] == ["Coffee", "grounds", "are", "natural", "deodorizers."]
    assert words[1].start == 0.4
    assert words[-1].end == 2.2


def test_align_interpolates_missing_words():
    tokens = script_tokens("I tried TIFU yesterday and it worked")
    recognized = [Word("I", 0.0, 0.2), Word("tried", 0.2, 0.5), Word("yesterday", 1.2, 1.7),
                  Word("and", 1.7, 1.8), Word("it", 1.8, 1.9), Word("worked", 1.9, 2.3)]
    words = align(tokens, recognized, 0.0, 2.5)
    assert len(words) == len(tokens)
    assert words[2].text == "TIFU"
    assert 0.5 <= words[2].start <= words[2].end <= 1.2
    assert_ordered(words, 0.0, 2.5)


def test_align_without_recognition_is_proportional():
    words = align(["a", "b"], [], 0.0, 1.0)
    assert len(words) == 2
    assert_ordered(words, 0.0, 1.0)


def test_align_never_overlaps_with_bad_recognizer_times():
    tokens = ["one", "two", "three"]
    recognized = [Word("one", 0.5, 1.0), Word("two", 0.2, 0.4), Word("three", 0.9, 3.0)]
    words = align(tokens, recognized, 0.0, 2.0)
    assert_ordered(words, 0.0, 2.0)
