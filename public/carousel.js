document.querySelectorAll(".carousel").forEach(function(carousel) {
	const track = carousel.querySelector(".carouselTrack");
	const slides = carousel.querySelectorAll(".carouselSlide");
	const previous = carousel.querySelector(".carouselPrev");
	const next = carousel.querySelector(".carouselNext");
	const count = carousel.querySelector(".carouselCount");

	function current() {
		return Math.round(track.scrollLeft / track.clientWidth);
	}

	function update() {
		const index = current();

		previous.disabled = index === 0;
		next.disabled = index === slides.length - 1;
		count.textContent = (index + 1) + " / " + slides.length;
	}

	function go(index) {
		const last = slides.length - 1;
		const target = Math.min(Math.max(index, 0), last);

		track.scrollTo({ left: target * track.clientWidth });
	}

	previous.addEventListener("click", function() {
		go(current() - 1);
	});

	next.addEventListener("click", function() {
		go(current() + 1);
	});

	track.addEventListener("keydown", function(event) {
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			go(current() - 1);
		} else if (event.key === "ArrowRight") {
			event.preventDefault();
			go(current() + 1);
		}
	});

	track.addEventListener("scroll", update, { passive: true });
	window.addEventListener("resize", update);

	carousel.classList.add("ready");
	update();
});
