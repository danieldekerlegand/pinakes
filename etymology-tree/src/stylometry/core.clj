(ns stylometry.core
	(:require [stylometry.iso-639-b :as iso]
						[clojure.java.io :as io]
						[clojure.data.csv :as csv]))

(defn fixup-name [name]
  (-> name
      clojure.string/lower-case
      (clojure.string/replace #": " "-")
      (clojure.string/replace #" " "-")
      keyword))

(def etymology
  (with-open [rdr (clojure.java.io/reader "data/etymwn.tsv")]
    (reduce (fn [m line] (let [[s p o] (clojure.string/split line #"\t")]
                          (cond (or (= p "rel:is_derived_from")
                                    (= p "rel:etymology"))
                           (let [fs (fixup-name s)]
                             (assoc m fs (distinct (conj (get m fs []) (fixup-name o)))))
                           ;; other direction
                           (= p "rel:etymological_origin_of")
                           (let [fo (fixup-name o)]
                             (assoc m fo (distinct (conj (get m fo []) (fixup-name s)))))
                           :else m)))
            {}
            (line-seq rdr))))

(defn trace-etymology
  ([etym] (distinct (trace-etymology etym #{})))
  ([etym seen] (conj (mapcat #(trace-etymology % (conj seen %))
                             (remove seen (etymology etym))) etym)))

(defn tokenize [lang phrase]
  (->  phrase
       clojure.string/lower-case
       (clojure.string/split #"[^\w]+")
       (#(mapv (fn [w] (keyword (str lang "-" w))) %))))

(defn word-origin-frequencies [lang text]
  (frequencies
   (mapcat (comp (partial map #(subs (str %) 1 (.indexOf (str %) "-")))
                 (partial remove #(re-find #"^:eng-|^:p_" (str %)))
                 trace-etymology)
           (tokenize lang text))))

(defn unique-etymologies [text]
	(distinct
		(mapv trace-etymology
			(tokenize "eng" text))))

(defn -main [& args]
	(with-open [wrtr (io/writer "data/foo.txt")]
		(doseq [i (unique-etymologies (slurp (apply str args)))]
			(.write wrtr (str (pr-str i) "\n")))))

;
; (defn report-percentages [rs]
;   (let [tot (apply + (vals rs))]
;     (sort-by second > (map #(vector (iso/iso-639-b (first %)) (float (* 100 (/ (second %) tot )))) rs))))
;
; (defn -main [& args]
; 	(println
; 		;(report-percentages
; 			(word-origin-frequencies "eng" (slurp (apply str args)))));)
